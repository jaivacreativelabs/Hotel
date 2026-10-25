import { PAYMENT_METHODS, type PaymentMethod, type TransactionDTO } from '@rb/shared';
import { CircleCheck, Printer } from 'lucide-react';
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

export function BillDoneModal({ tx, onClose, closeLabel = 'Done' }: { tx: TransactionDTO; onClose: () => void; closeLabel?: string }) {
  return (
    <Modal title="Bill generated" onClose={onClose}>
      <div className="alert alert-success">
        <CircleCheck />
        <span>
          Bill <strong>#{tx.billNumber}</strong> for <strong>{formatMoney(tx.grandTotal)}</strong> was saved ({PAYMENT_LABEL[tx.paymentMethod]}).
        </span>
      </div>
      <div className="modal-actions">
        <button className="btn btn-outline" onClick={() => openReceipt(tx.id)}>
          <Printer /> Print Bill
        </button>
        <button className="btn btn-primary" onClick={onClose}>
          {closeLabel}
        </button>
      </div>
    </Modal>
  );
}
