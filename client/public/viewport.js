/* global screen, document, window, setTimeout, clearTimeout */
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

  // Back from another app, or after a bill printed: zoom back out if Safari zoomed in anyway.
  var reset = function () {
    if (document.visibilityState !== 'hidden') lockScale(true);
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
