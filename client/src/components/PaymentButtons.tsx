import { PAYMENT_METHODS, type PaymentMethod, type TransactionDTO } from '@rb/shared';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
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
let printing: { root: Root; el: HTMLElement; frame: HTMLIFrameElement; timer: number } | null = null;

function clearPrint() {
  if (!printing) return;
  clearTimeout(printing.timer);
  printing.root.unmount();
  printing.el.remove();
  printing.frame.remove();
  printing = null;
}

/**
 * Prints a bill without leaving the page, the same way on every device:
 *  - a hidden frame loads the receipt page, which prints itself. Laptops print that frame (the
 *    bill), and Safari does not block it although the bill is saved a moment after the tap.
 *  - tablets (iPad Safari, Android Chrome) print the whole page instead of the frame, so the
 *    receipt is also put into this page, and on paper the page shows only the receipt.
 * The receipt stays (hidden on screen) while the print dialog may still read it: until the next
 * print, or ten minutes.
 */
export function printReceipt(t: TransactionDTO) {
  clearPrint();
  const el = document.createElement('div');
  el.id = PRINT_ROOT_ID;
  document.body.appendChild(el);
  const root = createRoot(el);
  flushSync(() =>
    root.render(
      <>
        <style>{IN_PAGE_CSS}</style>
        <Receipt t={t} onLogoDone={() => undefined} />
      </>,
    ),
  );
  const frame = document.createElement('iframe');
  frame.title = 'Bill';
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.src = `/print/transactions/${t.id}?autoprint=1`;
  document.body.appendChild(frame);
  printing = { root, el, frame, timer: window.setTimeout(clearPrint, 10 * 60_000) };
}
