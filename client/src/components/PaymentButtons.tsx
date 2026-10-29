import { mainPaymentMethod, parseRupeesToPaise, PAYMENT_METHODS, type PaymentMethod, type PaymentPart, type TransactionDTO } from '@rb/shared';
import { Split } from 'lucide-react';
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { cx, formatMoney, PAYMENT_LABEL } from '../utils/format';
import { PAYMENT_ICON } from './badges';
import { ChangeCalculator } from './ChangeCalculator';
import { Receipt, RECEIPT_CSS } from './Receipt';
import { CancelButton, ConfirmButton, Modal } from './ui';

/** A payment mode, or SPLIT for a bill paid partly one way and partly another. */
export type PaymentChoice = PaymentMethod | 'SPLIT';

/** What to send when generating: the main mode, plus the parts of a split payment. */
export function paymentFields(choice: PaymentChoice, parts: PaymentPart[] | null): { paymentMethod: PaymentMethod; payments?: PaymentPart[] } {
  return choice === 'SPLIT' ? { paymentMethod: mainPaymentMethod(parts!), payments: parts! } : { paymentMethod: choice };
}

export function PaymentButtons<T extends PaymentChoice>({
  value,
  onChange,
  disabled,
  allowSplit,
}: {
  value: T | null;
  onChange: (m: T) => void;
  disabled?: boolean;
  /** adds "Split" – part cash, part UPI / card */
  allowSplit?: boolean;
}) {
  const choices: PaymentChoice[] = allowSplit ? [...PAYMENT_METHODS, 'SPLIT'] : [...PAYMENT_METHODS];
  return (
    <div className={cx('pay-methods', allowSplit && 'with-split')} role="radiogroup" aria-label="Payment method">
      {choices.map((m) => {
        const Icon = m === 'SPLIT' ? Split : PAYMENT_ICON[m];
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={value === m}
            className={cx('pay-btn', value === m && 'active')}
            onClick={() => onChange(m as T)}
            disabled={disabled}
            title={m === 'SPLIT' ? 'Paid partly one way and partly another, e.g. cash + UPI' : undefined}
          >
            <Icon />
            {m === 'SPLIT' ? 'Split' : PAYMENT_LABEL[m]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A split payment: how much was paid one way; the rest of the bill goes to the other mode.
 * Reports the parts (or null while they do not make sense) through onChange.
 */
export function SplitPayment({ total, initial, onChange }: { total: number; initial?: PaymentPart[]; onChange: (parts: PaymentPart[] | null) => void }) {
  const [first, setFirst] = useState<PaymentMethod>(initial?.[0]?.method ?? 'UPI');
  const [rest, setRest] = useState<PaymentMethod>(initial?.[1]?.method ?? 'CASH');
  const [amount, setAmount] = useState(initial?.[0] ? String(initial[0].amount / 100) : '');
  const paise = amount.trim() ? parseRupeesToPaise(amount) : null;
  const ok = paise !== null && paise > 0 && paise < total && first !== rest;
  const restAmount = paise !== null ? total - paise : null;

  useEffect(() => {
    onChange(ok ? [{ method: first, amount: paise! }, { method: rest, amount: total - paise! }] : null);
  }, [ok, first, rest, paise, total, onChange]);

  const pickFirst = (m: PaymentMethod) => {
    setFirst(m);
    if (m === rest) setRest(PAYMENT_METHODS.find((x) => x !== m)!);
  };
  const select = (value: PaymentMethod, set: (m: PaymentMethod) => void, label: string, without?: PaymentMethod) => (
    <select className="select select-sm" value={value} onChange={(e) => set(e.target.value as PaymentMethod)} aria-label={label}>
      {PAYMENT_METHODS.filter((m) => m !== without).map((m) => (
        <option key={m} value={m}>
          {PAYMENT_LABEL[m]}
        </option>
      ))}
    </select>
  );
  return (
    <div className="split-pay">
      <div className="split-row">
        {select(first, pickFirst, 'First payment mode')}
        <div className="input-prefix change-calc-input">
          <span>₹</span>
          <input className="input input-sm" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={`Amount paid by ${PAYMENT_LABEL[first]}`} autoFocus />
        </div>
      </div>
      <div className="split-row">
        {select(rest, setRest, 'Payment mode for the rest', first)}
        <span className={cx('split-rest num', restAmount !== null && !ok && 'bad')}>
          {restAmount === null ? 'Rest –' : restAmount > 0 ? `${formatMoney(restAmount)} (rest)` : `Must be under ${formatMoney(total)}`}
        </span>
      </div>
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
  onConfirm: (payment: { paymentMethod: PaymentMethod; payments?: PaymentPart[] }) => Promise<void>;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<PaymentChoice | null>(null);
  const [parts, setParts] = useState<PaymentPart[] | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={busy ? () => undefined : onClose}>
      <div className="total-box">
        <span>Total</span>
        <strong>{formatMoney(amount)}</strong>
      </div>
      <PaymentButtons value={method} onChange={setMethod} disabled={busy} allowSplit />
      {method === 'CASH' && <ChangeCalculator total={amount} />}
      {method === 'SPLIT' && <SplitPayment total={amount} onChange={setParts} />}
      <div className="modal-actions">
        <CancelButton onClick={onClose} disabled={busy} />
        <ConfirmButton
          busy={busy}
          disabled={!method || (method === 'SPLIT' && !parts)}
          label="Generate Bill"
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm(paymentFields(method!, parts));
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
