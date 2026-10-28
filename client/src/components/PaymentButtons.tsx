import { PAYMENT_METHODS, type PaymentMethod, type TransactionDTO } from '@rb/shared';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ToastApi } from '../store/toast';
import { cx, formatMoney, PAYMENT_LABEL } from '../utils/format';
import { PAYMENT_ICON } from './badges';
import { Receipt, RECEIPT_CSS } from './Receipt';
import { CancelButton, ConfirmButton, Modal } from './ui';

export function PaymentButtons({ value, onChange, disabled }: { value: PaymentMethod | null; onChange: (m: PaymentMethod) => void; disabled?: boolean }) {
  return (
    <div className="pay-methods" role="radiogroup" aria-label="Payment method">
      {PAYMENT_METHODS.map((m) => {
        const Icon = PAYMENT_ICON[m];
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={value === m}
            className={cx('pay-btn', value === m && 'active')}
            onClick={() => onChange(m)}
            disabled={disabled}
          >
            <Icon />
            {PAYMENT_LABEL[m]}
          </button>
        );
      })}
    </div>
  );
}

/** Asks for the payment method, then finalises. Used from the table group card. */
export function PaymentModal({
  title,
  amount,
  onConfirm,
  onClose,
}: {
  title: string;
  amount: number;
  onConfirm: (method: PaymentMethod) => Promise<void>;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={busy ? () => undefined : onClose}>
      <div className="total-box">
        <span>Total</span>
        <strong>{formatMoney(amount)}</strong>
      </div>
      <PaymentButtons value={method} onChange={setMethod} disabled={busy} />
      <div className="modal-actions">
        <CancelButton onClick={onClose} disabled={busy} />
        <ConfirmButton
          busy={busy}
          disabled={!method}
          label="Generate Bill"
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm(method!);
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
    </Modal>
  );
}

const PRINT_ROOT_ID = 'receipt-print-root';
// While a receipt is mounted, printing shows only the receipt (the app stays on screen).
const IN_PAGE_CSS = `
#${PRINT_ROOT_ID} { display: none; }
@media print {
  @page { size: 80mm auto; margin: 4mm; }
  html, body { height: auto !important; background: #fff !important; }
  body > *:not(#${PRINT_ROOT_ID}) { display: none !important; }
  #${PRINT_ROOT_ID} { display: block; }
}
${RECEIPT_CSS}
`;
let printing: { root: Root; el: HTMLElement } | null = null;

function clearPrint() {
  printing?.root.unmount();
  printing?.el.remove();
  printing = null;
}

const TRIGGER_ID = 'receipt-print-trigger';

/**
 * Safari – and every browser on an iPad or iPhone – blocks a page that prints on its own, i.e.
 * not straight from a tap (after Generate Bill the bill prints once the server has saved it).
 */
function isApplePrinting() {
  const ua = navigator.userAgent;
  const appleTouch = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return appleTouch || (/Safari\//.test(ua) && !/Chrome|Chromium|Edg|OPR|Android/.test(ua));
}

/**
 * Prints a bill without leaving the page. The receipt is put into this page and printed on its
 * own – tablets (iPad Safari, Android Chrome) print the whole page when a frame or a popup tries
 * to print. It prints right away when the logo is ready (it is normally cached – the sidebar
 * shows it), so a print from a tap stays a tap. On Apple devices a hidden frame starts the print
 * (see public/print-now.html): Safari does not block that, even long after the tap.
 */
export function printReceipt(t: TransactionDTO) {
  clearPrint();
  document.getElementById(TRIGGER_ID)?.remove();
  const el = document.createElement('div');
  el.id = PRINT_ROOT_ID;
  document.body.appendChild(el);
  const root = createRoot(el);
  printing = { root, el };
  flushSync(() =>
    root.render(
      <>
        <style>{IN_PAGE_CSS}</style>
        <Receipt t={t} onLogoDone={() => undefined} />
      </>,
    ),
  );
  const apple = isApplePrinting();
  // Safari may still be drawing the print preview when afterprint fires, so there the receipt
  // stays (hidden on screen) until the next print replaces it.
  if (!apple) window.addEventListener('afterprint', () => printing?.el === el && clearPrint(), { once: true });
  const print = () => {
    if (!apple) return window.print();
    const frame = document.createElement('iframe');
    frame.id = TRIGGER_ID;
    frame.title = 'Print';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    frame.src = '/print-now.html';
    document.body.appendChild(frame);
  };
  const logo = el.querySelector('img');
  if (!logo || logo.complete) print();
  else {
    logo.addEventListener('load', print, { once: true });
    logo.addEventListener('error', print, { once: true });
  }
}

/** A bill was generated: say so and print it. */
export function billGenerated(tx: TransactionDTO, toast: Pick<ToastApi, 'success' | 'withAction'>) {
  const saved = `Bill #${tx.billNumber} for ${formatMoney(tx.grandTotal)} saved (${PAYMENT_LABEL[tx.paymentMethod]})`;
  // In case Safari still holds the print back, a button prints it again from a tap.
  if (isApplePrinting()) {
    toast.withAction(`${saved} – printing…`, 'Print again', () => printReceipt(tx));
    printReceipt(tx);
    return;
  }
  toast.success(`${saved} – printing…`);
  printReceipt(tx);
}
