import { PAYMENT_METHODS, type PaymentMethod, type TransactionDTO } from '@rb/shared';
import { useState } from 'react';
import { cx, formatMoney, PAYMENT_LABEL } from '../utils/format';
import { PAYMENT_ICON } from './badges';
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

export function openReceipt(transactionId: string) {
  window.open(`/print/transactions/${transactionId}?autoprint=1`, '_blank', 'noopener,width=420,height=720');
}

/**
 * Prints a bill without leaving the page: a hidden frame loads the receipt, which prints itself.
 * Used right after a bill is generated, where a new window would be stopped by popup blockers.
 */
export function printReceipt(transactionId: string) {
  document.getElementById('receipt-print-frame')?.remove();
  const frame = document.createElement('iframe');
  frame.id = 'receipt-print-frame';
  frame.title = 'Bill';
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.src = `/print/transactions/${transactionId}?autoprint=1`;
  document.body.appendChild(frame);
}

/** A bill was generated: say so and print it. */
export function billGenerated(tx: TransactionDTO, toast: { success: (m: string) => void }) {
  toast.success(`Bill #${tx.billNumber} for ${formatMoney(tx.grandTotal)} saved (${PAYMENT_LABEL[tx.paymentMethod]}) – printing…`);
  printReceipt(tx.id);
}
