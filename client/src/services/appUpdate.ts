/**
 * Picks up a new version of the app by itself. A tablet keeps the app open for days (installed
 * as an app it has no reload button), so after an update it kept running the old version until
 * someone closed it completely.
 *
 * Every few minutes, and whenever the app is opened again, the page asks the server which version
 * is current (index.html names the app's script, whose name changes with every build). A new
 * version is loaded only at a moment nobody is working: right after coming back to the app before
 * any tap, or after two minutes without a touch – never with dishes on the bill being made (see
 * holdUpdates), a bill edit still being saved, text being typed, a window open or a receipt printing.
 */
import { syncSummary } from '../store/draftSync';

const CHECK_EVERY_MS = 5 * 60_000;
const TICK_MS = 30_000;
const IDLE_MS = 2 * 60_000;
/** A failed download of a page's code reloads once, not in a loop. */
const RELOAD_GUARD_KEY = 'rb-update-reload';

let newVersion = false;
let lastCheck = 0;
let lastTouch = Date.now();
let returnedAt = 0;
/** Reasons to wait, e.g. a bill on screen with dishes in it. */
const holds = new Set<string>();

/** While on, a new version is not loaded (it is loaded at the next quiet moment after). */
export function holdUpdates(reason: string, on: boolean) {
  if (on) holds.add(reason);
  else holds.delete(reason);
}

/** The app script this page runs, e.g. "/assets/index-YIjTriZ3.js"; null when not a built app. */
function runningScript(): string | null {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  return s ? new URL(s.src, location.href).pathname : null;
}

async function check(running: string): Promise<void> {
  lastCheck = Date.now();
  try {
    const res = await fetch('/', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return;
    const current = /<script[^>]*type="module"[^>]*src="([^"]*\/assets\/[^"]+\.js)"/.exec(await res.text())?.[1];
    if (current && new URL(current, location.href).pathname !== running) newVersion = true;
  } catch {
    // offline – try again later
  }
}

function quiet(): boolean {
  if (document.visibilityState !== 'visible' || holds.size > 0) return false;
  if (syncSummary().pending > 0) return false; // a bill edit not yet saved
  const el = document.activeElement;
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return false;
  if (document.querySelector('[role="dialog"], #receipt-print-root')) return false;
  return true;
}

function reload() {
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    /* storage blocked – reload anyway */
  }
  location.reload();
}

/** cameBack: just reopened – fine as long as nobody has touched the screen since. */
function reloadIfQuiet(cameBack: boolean) {
  if (!newVersion || !quiet()) return;
  const untouched = cameBack ? lastTouch < returnedAt : Date.now() - lastTouch > IDLE_MS;
  if (untouched) reload();
}

export function startAppUpdates() {
  // A page whose code changed while it was open: a screen not opened yet can no longer download
  // its old code. Load the new version (once per half minute at most, so it can never loop).
  window.addEventListener('vite:preloadError', (e) => {
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY)) || 0;
    } catch {
      /* storage blocked */
    }
    if (Date.now() - last < 30_000) return;
    e.preventDefault();
    reload();
  });

  const running = runningScript();
  if (!running) return; // development server

  const markTouch = () => {
    lastTouch = Date.now();
  };
  window.addEventListener('pointerdown', markTouch, { capture: true, passive: true });
  window.addEventListener('keydown', markTouch, { capture: true, passive: true });

  const cameBack = () => {
    if (document.visibilityState !== 'visible') return;
    returnedAt = Date.now();
    void check(running).then(() => reloadIfQuiet(true));
  };
  document.addEventListener('visibilitychange', cameBack);
  window.addEventListener('pageshow', (e) => e.persisted && cameBack());
  window.addEventListener('online', () => void check(running));

  window.setInterval(() => {
    if (newVersion) reloadIfQuiet(false);
    else if (document.visibilityState === 'visible' && Date.now() - lastCheck > CHECK_EVERY_MS) void check(running);
  }, TICK_MS);
}
