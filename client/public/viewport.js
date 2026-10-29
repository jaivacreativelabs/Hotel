/* global screen, document, window */
(function () {
  // The app is exactly as tall as the visible screen (app.css uses --app-height). Safari's
  // 100vh also counts the space behind its toolbars, which pushed the bill's Cash / UPI / Card
  // and Generate Bill buttons below the screen on iPads.
  var setHeight = function () {
    // While printing, the page is laid out for paper: its height is not the screen's.
    if (window.matchMedia && window.matchMedia('print').matches) return;
    document.documentElement.style.setProperty('--app-height', window.innerHeight + 'px');
  };
  setHeight();
  ['resize', 'orientationchange', 'pageshow', 'load'].forEach(function (type) {
    window.addEventListener(type, setHeight);
  });

  // Tablets get the laptop layout: lay the page out 1280px wide and let the
  // browser scale it to the screen, with no pinch / double-tap zoom (a zoomed
  // billing screen gets in the way at the counter). Phones (short side < 600px)
  // keep their own layout and zoom; desktop browsers ignore the viewport meta tag.
  if (Math.min(screen.width, screen.height) < 600) return;
  var FIT = 'width=1280, user-scalable=no';
  var meta = document.querySelector('meta[name="viewport"]');
  if (meta) meta.setAttribute('content', FIT);
  setHeight(); // the page is now laid out 1280px wide, so its height in page pixels changed

  // Printing lays the page out at the paper's width, and Safari then zooms the screen behind
  // the print window in to fit that narrow page. While a bill prints, the scale is held at the
  // laptop layout's (screen width / 1280) and let go at the next touch.
  var held = false;
  var hold = function () {
    if (!meta) return;
    var landscape = window.matchMedia('(orientation: landscape)').matches;
    var width = landscape
      ? Math.max(screen.width, screen.height)
      : Math.min(screen.width, screen.height);
    var scale = Math.round((width / 1280) * 10000) / 10000;
    if (!(scale > 0.3 && scale < 3)) return;
    meta.setAttribute(
      'content',
      FIT + ', initial-scale=' + scale + ', minimum-scale=' + scale + ', maximum-scale=' + scale,
    );
    held = true;
  };
  var release = function () {
    if (!held) return;
    held = false;
    meta.setAttribute('content', FIT);
    setHeight();
  };
  var print = window.print;
  window.print = function () {
    hold();
    return print.apply(window, arguments);
  };
  window.addEventListener('beforeprint', hold);
  window.addEventListener('afterprint', function () {
    setHeight();
    document.addEventListener('pointerdown', release, { once: true, passive: true });
  });
  window.addEventListener('orientationchange', release);
  // Only scrolling gestures (app.css); Android tablets also follow user-scalable=no.
  document.documentElement.classList.add('no-zoom');
  // iPad Safari ignores both for pinching, but lets the page cancel its gesture events.
  var stop = function (e) {
    e.preventDefault();
  };
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (type) {
    document.addEventListener(type, stop, { passive: false });
  });
})();
