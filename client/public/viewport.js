/* global screen, document */
// Tablets get the laptop layout: lay the page out 1280px wide and let the
// browser scale it to the screen. Phones (short side < 600px) keep their own
// layout; desktop browsers ignore the viewport meta tag anyway.
(function () {
  if (Math.min(screen.width, screen.height) < 600) return;
  var meta = document.querySelector('meta[name="viewport"]');
  if (meta) meta.setAttribute('content', 'width=1280');
})();
