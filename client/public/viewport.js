/* global screen, document */
// Tablets get the laptop layout: lay the page out 1280px wide and let the
// browser scale it to the screen, with no pinch / double-tap zoom (a zoomed
// billing screen gets in the way at the counter). Phones (short side < 600px)
// keep their own layout and zoom; desktop browsers ignore the viewport meta tag.
(function () {
  if (Math.min(screen.width, screen.height) < 600) return;
  var meta = document.querySelector('meta[name="viewport"]');
  if (meta) meta.setAttribute('content', 'width=1280, user-scalable=no');
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
