/**
 * Top bar: the Bluetooth bill printer (Chrome only – see services/btPrinter.ts). While it is
 * connected, Generate Bill prints straight to it with no print popup.
 */
import { Printer } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  bluetoothSupported,
  choosePrinter,
  connectAgain,
  forgetPrinter,
  getPrinterState,
  printTest,
  reconnectSavedPrinter,
  reconnectsAlone,
  setPaper,
  subscribePrinter,
} from '../services/btPrinter';
import { useToast } from '../store/toast';
import { cx } from '../utils/format';
import type { PaperWidth } from '../utils/escpos';
import { Modal, Spinner } from './ui';

const STATUS_TEXT = { none: 'Connect printer', connecting: 'Connecting…', connected: 'Printer', disconnected: 'Printer off' } as const;

export function PrinterButton() {
  const state = useSyncExternalStore(subscribePrinter, getPrinterState);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void reconnectSavedPrinter();
  }, []);
  if (!bluetoothSupported()) return null;
  // After a reload Chrome may hand the printer back only from a tap: then the button itself is
  // that tap, and Chrome's list shows just this printer.
  const needsTap = state.status === 'disconnected' && !state.known;
  return (
    <>
      <button
        type="button"
        className={cx('printer-pill', state.status)}
        onClick={() => {
          if (!needsTap) return setOpen(true);
          connectAgain(state.paper).then(
            () => toast.success('Printer connected'),
            (err: unknown) => (err instanceof Error && err.name === 'NotFoundError' ? setOpen(true) : toast.error(err)),
          );
        }}
        title={state.status === 'connected' ? `Bills print on ${state.name}` : 'Bluetooth bill printer'}
      >
        <Printer size={16} />
        <span className="printer-text">{needsTap ? 'Tap to connect printer' : STATUS_TEXT[state.status]}</span>
      </button>
      {open && <PrinterModal onClose={() => setOpen(false)} />}
    </>
  );
}

function PrinterModal({ onClose }: { onClose: () => void }) {
  const state = useSyncExternalStore(subscribePrinter, getPrinterState);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (job: () => Promise<void>, done?: string) => {
    setBusy(true);
    try {
      await job();
      if (done) toast.success(done);
    } catch (err) {
      // Closing Chrome's Bluetooth list without choosing is not an error.
      if (!(err instanceof Error && err.name === 'NotFoundError')) toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const working = busy || state.status === 'connecting';

  return (
    <Modal title="Bill printer" onClose={onClose} width={460}>
      <div className="stack" style={{ gap: 18 }}>
        <div className={cx('printer-status', state.status)}>
          <Printer />
          <div>
            <b>{state.status === 'none' ? 'No printer' : state.name}</b>
            <div className="muted">
              {state.status === 'connected'
                ? 'Connected – bills print straight away, no popup.'
                : state.status === 'connecting'
                  ? 'Connecting…'
                  : state.status === 'disconnected'
                    ? state.known
                      ? 'Not connected – it connects by itself when the printer is on and near. Until then bills open the print popup.'
                      : 'Not connected – tap Connect. Until then bills open the print popup.'
                    : 'Bills open the print popup.'}
            </div>
            {state.error && state.status !== 'connected' && <div className="field-error">{state.error}</div>}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Paper roll</span>
          <div className="pay-methods order-types" role="radiogroup" aria-label="Paper roll width">
            {([58, 80] as PaperWidth[]).map((w) => (
              <button key={w} type="button" role="radio" aria-checked={state.paper === w} className={cx('pay-btn', state.paper === w && 'active')} onClick={() => setPaper(w)}>
                {w} mm
              </button>
            ))}
          </div>
          <span className="field-hint">Not sure? 58 mm prints on both sizes.</span>
        </div>

        <div className="modal-actions">
          {state.status === 'connected' ? (
            <button type="button" className="btn btn-outline" disabled={working} onClick={() => void run(printTest)}>
              Test print
            </button>
          ) : (
            state.status === 'disconnected' && (
              <button type="button" className="btn btn-outline" disabled={working} onClick={() => void run(() => connectAgain(state.paper), 'Printer connected')}>
                Connect
              </button>
            )
          )}
          <button type="button" className="btn btn-primary" disabled={working} onClick={() => void run(() => choosePrinter(state.paper), 'Printer connected')}>
            {working && <Spinner />} {state.status === 'none' ? 'Choose printer' : 'Change printer'}
          </button>
        </div>
        {state.status !== 'none' && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run(forgetPrinter)}>
            Stop using this printer
          </button>
        )}
        {state.history.length > 0 && (
          <details className="printer-history">
            <summary>Recent printer events</summary>
            <ul>
              {state.history.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </details>
        )}
        <p className="field-hint" style={{ margin: 0 }}>
          Switch the printer on and turn on Bluetooth (and Location) on this tablet, then tap Choose printer and pick it from the list.
        </p>
        {!reconnectsAlone() && (
          <p className="field-hint" style={{ margin: 0 }}>
            After a refresh, or when the printer was out of range, this Chrome needs one tap on the printer button. To have it
            reconnect by itself, open <b>chrome://flags</b>, enable <b>Use the new permissions backend for Web Bluetooth</b> and{' '}
            <b>Experimental Web Platform features</b>, then tap Relaunch.
          </p>
        )}
      </div>
    </Modal>
  );
}
