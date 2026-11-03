/* global screen, document, window, navigator, setTimeout, clearTimeout */
(function () {
  var root = document.documentElement;
  // The app is exactly as tall as the visible screen (app.css uses --app-height). Safari's
  // 100vh also counts the space behind its toolbars, which pushed the bill's Cash / UPI / Card
  // and Generate Bill buttons below the screen on iPads.
  var setHeight = function () {
    // While printing, the page is laid out for paper: its height is not the screen's.
    if (window.matchMedia && window.matchMedia('print').matches) return;
    // clientHeight, not innerHeight: Safari's innerHeight shrinks while the page is zoomed in
    // (e.g. for a moment when coming back from another app), which left the app half the screen tall.
    root.style.setProperty('--app-height', root.clientHeight + 'px');
  };
  setHeight();
  ['resize', 'orientationchange', 'pageshow', 'load', 'focus'].forEach(function (type) {
    window.addEventListener(type, setHeight);
  });
  document.addEventListener('visibilitychange', setHeight);

  // Tablets get the laptop layout: lay the page out 1280px wide and scale it to the screen,
  // with no zoom at all (a zoomed billing screen gets in the way at the counter). Phones
  // (short side < 600px) keep their own layout and zoom; desktop browsers ignore the viewport meta tag.
  if (Math.min(screen.width, screen.height) < 600) return;
  var FIT = 'width=1280, user-scalable=no';
  var meta = document.querySelector('meta[name="viewport"]');
  if (meta) meta.setAttribute('content', FIT);
  setHeight(); // the page is now laid out 1280px wide, so its height in page pixels changed

  // The scale stays fixed at the laptop layout's (screen width / 1280), as both the smallest and
  // the largest allowed. Left free even for a moment, iPad Safari zooms in on its own and stays
  // there: coming back from another app it puts the focus back in the last text box (search,
  // amount…), whose text is under 16px on screen, and zooms in to it; printing zooms too.
  var scale = 0;
  var nudge = 0;
  var touch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchend' in document;
  /** force: apply it again even when the scale has not changed, which zooms Safari back out. */
  var lockScale = function (force) {
    if (!meta) return;
    var landscape = window.matchMedia('(orientation: landscape)').matches;
    var width = landscape
      ? Math.max(screen.width, screen.height)
      : Math.min(screen.width, screen.height);
    var next = Math.round((width / 1280) * 10000) / 10000;
    if (!(next > 0.3 && next < 3)) return;
    if (next === scale && !force) return;
    scale = next;
    // Touch screens: text boxes get text of 16px on the screen (16px ÷ scale on the page), like
    // other websites. Safari zooms in to any text box whose text looks smaller than that,
    // whatever the viewport says (app.css, html.touch-inputs).
    if (touch) {
      root.style.setProperty('--touch-input-font', Math.max(16, Math.ceil((16 / scale) * 10) / 10) + 'px');
      root.classList.add('touch-inputs');
    }
    // Safari ignores the same text set again, so a forced lock differs by a hair (0.01%).
    nudge = force && !nudge ? 0.0001 : 0;
    var s = (scale + nudge).toFixed(4);
    meta.setAttribute(
      'content',
      FIT + ', initial-scale=' + s + ', minimum-scale=' + s + ', maximum-scale=' + s
    );
    setHeight();
  };
  lockScale();

  // Rotating (or a resize) changes the screen's width: the scale follows it.
  var resizeTimer = 0;
  var refit = function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      lockScale();
    }, 250);
  };
  window.addEventListener('resize', refit);
  window.addEventListener('orientationchange', refit);

  // Leaving for another app: take the cursor out of the text box. Coming back, Safari puts the
  // focus back in it and zooms in to it a moment later (after any "page is back" event), so
  // with nothing focused there is nothing to zoom to.
  var dropFocus = function () {
    var el = document.activeElement;
    if (el && el !== document.body && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.blur) el.blur();
  };
  window.addEventListener('pagehide', dropFocus);
  window.addEventListener('blur', dropFocus);

  // Zoomed in = the visible part of the page is narrower than the page. Safari can zoom after
  // every event it sends us, so watch for it and zoom back out (a few tries at most, so a
  // Safari that refuses can never cause a loop).
  var vv = window.visualViewport;
  var zoomedIn = function () {
    return !!vv && vv.width > 0 && vv.width < root.clientWidth * 0.97;
  };
  var tries = 0;
  var triesTimer = 0;
  var unzoom = function () {
    if (document.visibilityState === 'hidden' || !zoomedIn() || tries >= 4) return;
    tries += 1;
    clearTimeout(triesTimer);
    triesTimer = setTimeout(function () {
      tries = 0;
    }, 3000);
    lockScale(true);
  };
  var zoomTimer = 0;
  if (vv) {
    vv.addEventListener('resize', function () {
      clearTimeout(zoomTimer);
      zoomTimer = setTimeout(unzoom, 150);
    });
  }

  // Back from another app, or after a bill printed: zoom back out if Safari zoomed in anyway,
  // and check again over the next moments, as Safari may zoom only after this.
  var reset = function () {
    if (document.visibilityState === 'hidden') return dropFocus();
    lockScale(true);
    [300, 800, 1600].forEach(function (ms) {
      setTimeout(unzoom, ms);
    });
  };
  window.addEventListener('pageshow', reset);
  document.addEventListener('visibilitychange', reset);
  window.addEventListener('afterprint', function () {
    reset();
    // Safari does not always tell the page when its print window closes: the next touch does.
    document.addEventListener('pointerdown', reset, { once: true, passive: true });
  });

  // Only scrolling gestures (app.css); Android tablets also follow user-scalable=no.
  root.classList.add('no-zoom');
  // iPad Safari ignores both for pinching, but lets the page cancel its gesture events.
  var stop = function (e) {
    e.preventDefault();
  };
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (type) {
    document.addEventListener(type, stop, { passive: false });
  });
})();
