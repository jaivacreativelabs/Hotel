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
let printing: { root: Root; el: HTMLElement; timer?: number } | null = null;

function clearPrint() {
  if (!printing) return;
  clearTimeout(printing.timer);
  printing.root.unmount();
  printing.el.remove();
  printing = null;
}

/**
 * Prints a bill: the receipt is put into this page and printed at once, and on paper the page
 * shows only the receipt. Call it straight from the tap (Safari on an iPad prints only from a
 * tap – see apiSync); the logo is normally ready because the sidebar already shows it.
 * The receipt stays (hidden on screen) a minute after printing, as Safari may still be reading
 * the page for its print preview.
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
  const current: NonNullable<typeof printing> = { root, el };
  printing = current;
  window.addEventListener(
    'afterprint',
    () => {
      if (printing === current) current.timer = window.setTimeout(clearPrint, 60_000);
    },
    { once: true },
  );
  window.print();
}
