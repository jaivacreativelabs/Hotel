/** New Bill › Add Sale: a bill of just an amount and a payment mode, without choosing dishes. */
import { formatMoney, parseRupeesToPaise, type PaymentPart, type TransactionDTO } from '@rb/shared';
import { useRef, useState } from 'react';
import { api } from '../services/api';
import { useToast } from '../store/toast';
import { newIdempotencyKey } from '../utils/format';
import { PaymentButtons, paymentFields, SplitPayment, type PaymentChoice } from './PaymentButtons';
import { CancelButton, ConfirmButton, Field, Modal } from './ui';

export function ManualSaleModal({ onClose, onDone }: { onClose: () => void; onDone: (t: TransactionDTO) => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentChoice | null>(null);
  const [parts, setParts] = useState<PaymentPart[] | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key for this sale: a second tap returns the same bill instead of a new one.
  const keyRef = useRef(newIdempotencyKey());

  /** Only saves the sale – no bill is printed (it can be printed later from Transactions). */
  const save = async () => {
    const paise = parseRupeesToPaise(amount);
    if (paise === null || paise < 100) return setError('Enter an amount like 250 or 49.50');
    if (!method || (method === 'SPLIT' && !parts)) return;
    setError(null);
    setBusy(true);
    try {
      const { transaction } = await api.post<{ transaction: TransactionDTO }>('/bills/manual-sale', {
        amount: paise,
        ...paymentFields(method, parts),
        ...(customerName.trim() && { customerName: customerName.trim() }),
        idempotencyKey: keyRef.current,
      });
      toast.success(`Sale of ${formatMoney(transaction.grandTotal)} saved (#${transaction.billNumber})`);
      onDone(transaction);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Add Sale" onClose={onClose}>
      <form
        className="stack"
        style={{ gap: 18 }}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
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
        <Field label="Name (optional)" hint="e.g. the customer or what was sold – shown in Transactions">
          {(id) => <input id={id} className="input" value={customerName} maxLength={80} onChange={(e) => setCustomerName(e.target.value)} placeholder="e.g. Ravi" />}
        </Field>
        <div className="field">
          <span className="field-label">Payment mode</span>
          <PaymentButtons value={method} onChange={setMethod} disabled={busy} allowSplit />
        </div>
        {method === 'SPLIT' && <SplitPayment total={parseRupeesToPaise(amount) ?? 0} onChange={setParts} />}
        <div className="modal-actions">
          <CancelButton onClick={onClose} disabled={busy} />
          <ConfirmButton type="submit" label="Add Sale" busy={busy} disabled={!amount.trim() || !method || (method === 'SPLIT' && !parts)} />
        </div>
      </form>
    </Modal>
  );
}
