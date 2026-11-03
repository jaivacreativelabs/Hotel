/**
 * A Bluetooth receipt printer, driven straight from the page (Web Bluetooth – Chrome on Android,
 * Windows, Mac): bills print with no print popup. Safari (iPad / iPhone) has no Web Bluetooth,
 * so there the popup stays (components/PaymentButtons.tsx printReceipt).
 *
 * The printer is chosen once with a tap (Chrome's own device list); this device remembers it and
 * connects again on its own after a reload or when the printer was switched off and on.
 */
import type { TransactionDTO } from '@rb/shared';
import { PAPER_COLUMNS, PAPER_DOTS, receiptCommands, toRaster, type PaperWidth, type Raster } from '../utils/escpos';

// The few Web Bluetooth types used here (TypeScript's DOM types do not have them).
interface BtCharacteristic {
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValueWithResponse(data: BufferSource): Promise<void>;
  writeValueWithoutResponse(data: BufferSource): Promise<void>;
}
interface BtService {
  getCharacteristics(): Promise<BtCharacteristic[]>;
}
interface BtServer {
  connected: boolean;
  connect(): Promise<BtServer>;
  disconnect(): void;
  getPrimaryServices(): Promise<BtService[]>;
}
interface BtDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: BtServer;
  forget?: () => Promise<void>;
}
interface Bluetooth {
  requestDevice(options: { acceptAllDevices?: boolean; filters?: { name: string }[]; optionalServices: string[] }): Promise<BtDevice>;
  getDevices?: () => Promise<BtDevice[]>;
}
const bluetooth = (): Bluetooth | undefined => (navigator as Navigator & { bluetooth?: Bluetooth }).bluetooth;

/** Can this browser talk to a Bluetooth printer at all? */
export const bluetoothSupported = () => typeof window !== 'undefined' && window.isSecureContext && !!bluetooth();

// The data services of common Bluetooth (BLE) receipt printers. A page may only use the services
// it names here, so a printer with none of them cannot be used.
const PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '0000ae00-0000-1000-8000-00805f9b34fb',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
];
// 20 bytes always fit in one Bluetooth packet, whatever the printer.
const CHUNK = 20;
const SAVED_KEY = 'rb-printer';

export type PrinterStatus = 'none' | 'connecting' | 'connected' | 'disconnected';
export interface PrinterState {
  status: PrinterStatus;
  name: string;
  paper: PaperWidth;
  error: string;
  /**
   * The page still holds the printer, so it reconnects on its own. False after a reload where
   * Chrome cannot hand the printer back (no getDevices): one tap on the printer button then.
   */
  known: boolean;
}

interface Saved {
  id: string;
  name: string;
  paper: PaperWidth;
}
function readSaved(): Saved | null {
  try {
    const s = JSON.parse(localStorage.getItem(SAVED_KEY) ?? 'null') as Saved | null;
    return s && typeof s.id === 'string' ? { ...s, paper: s.paper === 80 ? 80 : 58 } : null;
  } catch {
    return null;
  }
}
function writeSaved(s: Saved | null) {
  try {
    if (s) localStorage.setItem(SAVED_KEY, JSON.stringify(s));
    else localStorage.removeItem(SAVED_KEY);
  } catch {
    // private mode: the printer is chosen again next time
  }
}

const saved = readSaved();
let state: PrinterState = { status: saved ? 'disconnected' : 'none', name: saved?.name ?? '', paper: saved?.paper ?? 58, error: '', known: false };
const listeners = new Set<() => void>();
function setState(patch: Partial<PrinterState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export const getPrinterState = () => state;
export function subscribePrinter(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

let device: BtDevice | null = null;
let channel: BtCharacteristic | null = null;
let connecting: Promise<BtCharacteristic> | null = null;

const isConnected = () => !!(channel && device?.gatt?.connected);

// While the printer is away (switched off, asleep, out of range) the page keeps trying to
// reconnect, quietly and less often as time goes on, so the next bill prints with no popup.
const RETRY_MS = [2_000, 5_000, 10_000, 20_000, 30_000];
let retries = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
function keepConnected() {
  clearTimeout(retryTimer);
  if (!device || isConnected()) {
    retries = 0;
    return;
  }
  // Tablets pause hidden pages: tried again as soon as the app is back on screen.
  if (document.visibilityState === 'hidden') return;
  retryTimer = setTimeout(() => {
    if (!device) return;
    open(device, true).then(
      () => (retries = 0),
      () => {
        retries++;
        keepConnected();
      },
    );
  }, RETRY_MS[Math.min(retries, RETRY_MS.length - 1)]);
}
function reconnectNow() {
  retries = 0;
  if (device && !isConnected()) open(device, true).catch(keepConnected);
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reconnectNow());
  window.addEventListener('online', reconnectNow);
}

const onDisconnected = () => {
  channel = null;
  if (!device) return;
  setState({ status: 'disconnected' });
  retries = 0;
  keepConnected();
};

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e: unknown) => (clearTimeout(timer), reject(e instanceof Error ? e : new Error(String(e)))),
    );
  });
}

/**
 * Connects to `device` and finds where print data is written. `quiet`: a background retry – the
 * button keeps saying "Printer off" instead of flickering "Connecting…" and errors.
 */
function open(d: BtDevice, quiet = false, timeoutMs = 15_000): Promise<BtCharacteristic> {
  if (channel && d.gatt?.connected) return Promise.resolve(channel);
  if (connecting) return connecting;
  const attempt = (async () => {
    if (!quiet) setState({ status: 'connecting', error: '' });
    try {
      if (!d.gatt) throw new Error('This device is not a Bluetooth printer.');
      const server = await withTimeout(d.gatt.connect(), timeoutMs,'The printer did not answer. Is it switched on and near this tablet?');
      for (const service of await server.getPrimaryServices().catch(() => [] as BtService[])) {
        const found = (await service.getCharacteristics()).find((c) => c.properties.writeWithoutResponse || c.properties.write);
        if (found) {
          channel = found;
          setState({ status: 'connected', error: '' });
          return found;
        }
      }
      server.disconnect();
      throw new Error('This printer cannot be used from the browser (it has no Bluetooth LE print service).');
    } catch (err) {
      if (quiet) setState({ status: 'disconnected' });
      else setState({ status: 'disconnected', error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  })();
  connecting = attempt;
  const done = () => {
    if (connecting === attempt) connecting = null;
  };
  attempt.then(done, done);
  return attempt;
}

function adopt(d: BtDevice) {
  device?.removeEventListener('gattserverdisconnected', onDisconnected);
  device = d;
  d.addEventListener('gattserverdisconnected', onDisconnected);
  setState({ known: true });
}

/**
 * Opens Chrome's Bluetooth list to choose the printer. Call it from a tap. `onlySaved`: the list
 * shows just the printer chosen before (one tap to get it back after a reload).
 */
export async function choosePrinter(paper: PaperWidth, onlySaved = false): Promise<void> {
  const bt = bluetooth();
  if (!bt) throw new Error('This browser cannot use Bluetooth printers. Use Chrome.');
  const savedName = onlySaved ? readSaved()?.name : undefined;
  const d = await bt.requestDevice(
    savedName ? { filters: [{ name: savedName }], optionalServices: PRINTER_SERVICES } : { acceptAllDevices: true, optionalServices: PRINTER_SERVICES },
  );
  if (device && device !== d) device.gatt?.disconnect();
  channel = null;
  adopt(d);
  const name = d.name || 'Bluetooth printer';
  writeSaved({ id: d.id, name, paper });
  setState({ name, paper });
  await open(d).catch((err: unknown) => {
    keepConnected();
    throw err;
  });
}

export function setPaper(paper: PaperWidth) {
  const s = readSaved();
  if (s) writeSaved({ ...s, paper });
  setState({ paper });
}

/** Stops using the printer on this device (bills print with the popup again). */
export async function forgetPrinter() {
  const d = device;
  device = null;
  channel = null;
  clearTimeout(retryTimer);
  writeSaved(null);
  setState({ status: 'none', name: '', error: '', known: false });
  if (d) {
    d.removeEventListener('gattserverdisconnected', onDisconnected);
    d.gatt?.disconnect();
    await d.forget?.().catch(() => undefined);
  }
}

/** After a reload: finds the printer chosen before and connects to it (no tap needed). */
export async function reconnectSavedPrinter() {
  const s = readSaved();
  const bt = bluetooth();
  if (!s || !bt?.getDevices || device) return;
  const d = (await bt.getDevices().catch(() => [])).find((x) => x.id === s.id);
  if (!d) return; // Chrome cannot hand it back: one tap on the printer button gets it again
  adopt(d);
  // The printer may be off right now: keep trying until it is on and in range.
  await open(d, true).catch(keepConnected);
}

/** "Connect": the printer chosen before, now switched on or back in range. Call it from a tap. */
export async function connectAgain(paper: PaperWidth) {
  if (!device) await reconnectSavedPrinter();
  if (!device) return choosePrinter(paper, true);
  retries = 0;
  await open(device).catch((err: unknown) => {
    keepConnected();
    throw err;
  });
}

/** True when bills should go to the Bluetooth printer instead of the print popup. */
export const hasPrinter = () => device !== null;

const logos = new Map<string, Promise<Raster | null>>();
/** The restaurant logo as printer dots, about 18 mm wide (made once per logo). */
function logoRaster(url: string): Promise<Raster | null> {
  let p = logos.get(url);
  if (!p) {
    p = new Promise<Raster | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const w = 144;
          const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const rgba = ctx.getImageData(0, 0, w, h).data;
          const grey = new Float32Array(w * h);
          for (let i = 0; i < grey.length; i++) grey[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
          resolve(toRaster(grey, w, h));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
    logos.set(url, p);
  }
  return p;
}

let queue: Promise<unknown> = Promise.resolve();

/** Sends bytes to the printer, one bill at a time. */
function send(bytes: Uint8Array): Promise<void> {
  const job = queue.then(async () => {
    if (!device) throw new Error('No printer chosen.');
    // One retry: the printer may have slept or been switched off and on since the last bill.
    // Never once part of the bill went out – that would print half a bill and then a whole one.
    // A printer that is not connected gets one short try, so the popup is not kept waiting.
    const wasConnected = isConnected();
    for (let attempt = 0; ; attempt++) {
      let sent = 0;
      try {
        const c = await open(device, false, 8_000);
        const fast = c.properties.writeWithoutResponse;
        for (; sent < bytes.length; sent += CHUNK) {
          const part = bytes.slice(sent, sent + CHUNK);
          await (fast ? c.writeValueWithoutResponse(part) : c.writeValueWithResponse(part));
        }
        return;
      } catch (err) {
        channel = null;
        if (attempt > 0 || sent > 0 || !wasConnected) {
          setState({ status: device?.gatt?.connected ? 'connected' : 'disconnected', error: err instanceof Error ? err.message : String(err) });
          keepConnected();
          throw err;
        }
      }
    }
  });
  queue = job.catch(() => undefined);
  return job;
}

/** Prints a bill on the Bluetooth printer. */
export async function printBill(t: TransactionDTO): Promise<void> {
  const logo = t.restaurantSnapshot.logoUrl ? await logoRaster(t.restaurantSnapshot.logoUrl) : null;
  const fits = logo && logo.widthBytes * 8 <= PAPER_DOTS[state.paper] ? logo : null;
  await send(receiptCommands(t, PAPER_COLUMNS[state.paper], fits));
}

/** A short test slip, to check the printer and the paper size. */
export function printTest(): Promise<void> {
  const cols = PAPER_COLUMNS[state.paper];
  const text = ['', 'Printer connected', `Paper: ${state.paper} mm`, '-'.repeat(cols), '1234567890'.repeat(5).slice(0, cols), '-'.repeat(cols), '', '', '', ''].join('\n');
  return send(Uint8Array.from([0x1b, 0x40, ...Array.from(text, (c) => c.charCodeAt(0))]));
}
