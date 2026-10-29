/** New Bill › Add Sale: a bill of just an amount and a payment mode, without choosing dishes. */
import { parseRupeesToPaise, type PaymentMethod, type TransactionDTO } from '@rb/shared';
import { useRef, useState } from 'react';
import { apiSync } from '../services/api';
import { useToast } from '../store/toast';
import { newIdempotencyKey } from '../utils/format';
import { PaymentButtons, printReceipt } from './PaymentButtons';
import { CancelButton, ConfirmButton, Field, Modal } from './ui';

export function ManualSaleModal({ onClose, onDone }: { onClose: () => void; onDone: (t: TransactionDTO) => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [error, setError] = useState<string | null>(null);
  // One key for this sale: a second tap returns the same bill instead of a new one.
  const keyRef = useRef(newIdempotencyKey());

  /**
   * Saved within this tap (a synchronous request – the screen waits a moment), so the bill
   * prints at once: Safari on an iPad prints only from a tap.
   */
  const save = () => {
    const paise = parseRupeesToPaise(amount);
    if (paise === null || paise < 100) return setError('Enter an amount like 250 or 49.50');
    if (!method) return;
    setError(null);
    try {
      const { transaction } = apiSync.post<{ transaction: TransactionDTO }>('/bills/manual-sale', {
        amount: paise,
        paymentMethod: method,
        ...(customerName.trim() && { customerName: customerName.trim() }),
        idempotencyKey: keyRef.current,
      });
      printReceipt(transaction); // no message: the print itself shows the sale was saved
      onDone(transaction);
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal title="Add Sale" onClose={onClose}>
      <form
        className="stack"
        style={{ gap: 18 }}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Amount" error={error} hint="Just the total – no need to pick dishes">
          {(id) => (
            <div className="input-prefix input-prefix-xl">
              <span>₹</span>
              <input id={id} className="input input-xl" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </div>
          )}
        </Field>
        <Field label="Name (optional)" hint="e.g. the customer or what was sold – printed on the bill">
          {(id) => <input id={id} className="input" value={customerName} maxLength={80} onChange={(e) => setCustomerName(e.target.value)} placeholder="e.g. Ravi" />}
        </Field>
        <div className="field">
          <span className="field-label">Payment mode</span>
          <PaymentButtons value={method} onChange={setMethod} />
        </div>
        <div className="modal-actions">
          <CancelButton onClick={onClose} />
          <ConfirmButton type="submit" label="Add Sale" disabled={!amount.trim() || !method} />
        </div>
      </form>
    </Modal>
  );
}
