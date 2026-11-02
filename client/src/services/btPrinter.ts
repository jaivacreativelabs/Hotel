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
  requestDevice(options: { acceptAllDevices: boolean; optionalServices: string[] }): Promise<BtDevice>;
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
let state: PrinterState = { status: saved ? 'disconnected' : 'none', name: saved?.name ?? '', paper: saved?.paper ?? 58, error: '' };
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

const onDisconnected = () => {
  channel = null;
  if (device) setState({ status: 'disconnected' });
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

/** Connects to `device` and finds where print data is written. */
function open(d: BtDevice): Promise<BtCharacteristic> {
  if (channel && d.gatt?.connected) return Promise.resolve(channel);
  if (connecting) return connecting;
  const attempt = (async () => {
    setState({ status: 'connecting', error: '' });
    try {
      if (!d.gatt) throw new Error('This device is not a Bluetooth printer.');
      const server = await withTimeout(d.gatt.connect(), 10_000, 'The printer did not answer. Is it switched on and near this tablet?');
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
      setState({ status: 'disconnected', error: err instanceof Error ? err.message : String(err) });
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
}

/** Opens Chrome's Bluetooth list to choose the printer. Call it from a tap. */
export async function choosePrinter(paper: PaperWidth): Promise<void> {
  const bt = bluetooth();
  if (!bt) throw new Error('This browser cannot use Bluetooth printers. Use Chrome.');
  const d = await bt.requestDevice({ acceptAllDevices: true, optionalServices: PRINTER_SERVICES });
  if (device && device !== d) device.gatt?.disconnect();
  channel = null;
  adopt(d);
  const name = d.name || 'Bluetooth printer';
  writeSaved({ id: d.id, name, paper });
  setState({ name, paper });
  await open(d);
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
  writeSaved(null);
  setState({ status: 'none', name: '', error: '' });
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
  if (!d) return; // Chrome forgot the permission: the Printer button asks to choose it again
  adopt(d);
  await open(d).catch(() => undefined);
}

/** "Connect again": the printer chosen before, now switched on or back in range. */
export async function connectAgain() {
  if (!device) await reconnectSavedPrinter();
  if (!device) throw new Error('Tap Change printer and choose the printer again.');
  await open(device);
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
    for (let attempt = 0; ; attempt++) {
      let sent = 0;
      try {
        const c = await open(device);
        const fast = c.properties.writeWithoutResponse;
        for (; sent < bytes.length; sent += CHUNK) {
          const part = bytes.slice(sent, sent + CHUNK);
          await (fast ? c.writeValueWithoutResponse(part) : c.writeValueWithResponse(part));
        }
        return;
      } catch (err) {
        channel = null;
        if (attempt > 0 || sent > 0) {
          setState({ status: device?.gatt?.connected ? 'connected' : 'disconnected', error: err instanceof Error ? err.message : String(err) });
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
