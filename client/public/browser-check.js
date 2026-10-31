/* global document */
// Plain old JavaScript on purpose: it has to run in browsers too old for the app itself.
// main.tsx marks <html data-app-started> as soon as the app's code has loaded. A browser that
// cannot run it (no modules, newer syntax, a missing feature) never gets that far, and would
// otherwise show a blank white page. Say what to do instead.
(function () {
  if (!document.addEventListener) return;
  // The app's code did not arrive at all (a dropped connection): reloading helps, not a new browser.
  var notLoaded = false;
  document.addEventListener(
    'error',
    function (e) {
      if (e.target && e.target.tagName === 'SCRIPT') notLoaded = true;
    },
    true
  );
  document.addEventListener('DOMContentLoaded', function () {
    if (document.documentElement.hasAttribute('data-app-started')) return;
    var root = document.getElementById('root');
    if (!root) return;
    var box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.style.cssText =
      'max-width:440px;margin:15vh auto 0;padding:24px;border:1px solid #d9e6dc;border-radius:12px;' +
      'background:#fff;color:#1f2a22;font:15px/1.5 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;text-align:center;';
    var title = document.createElement('h1');
    title.style.cssText = 'margin:0 0 8px;font-size:20px;color:#1E7B34;';
    title.appendChild(document.createTextNode(notLoaded ? 'Could not load the app' : 'Please update your browser'));
    var text = document.createElement('p');
    text.style.margin = '0';
    text.appendChild(
      document.createTextNode(
        notLoaded
          ? 'Check the internet connection, then reload this page.'
          : 'Tiffin House POS cannot run in this browser. Open it in the latest Chrome, Edge, Firefox, ' +
              'Safari or Samsung Internet. On an iPad or iPhone, update to iOS 14.5 or later.'
      )
    );
    box.appendChild(title);
    box.appendChild(text);
    root.appendChild(box);
  });
})();
