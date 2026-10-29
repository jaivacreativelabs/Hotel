import { formatMoney, ORDER_TYPE_LABEL, type OrderType, type PaymentMethod, type PaymentPart, type TransactionStatus } from '@rb/shared';
import { Banknote, CreditCard } from 'lucide-react';
import { PAYMENT_LABEL, STATUS_LABEL } from '../utils/format';

/** Furniture-style table icon used in the navigation (lucide has no dining table). */
export function TableIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 7h18" />
      <path d="M4 7l1-3h14l1 3" />
      <path d="M6 7v13" />
      <path d="M18 7v13" />
      <path d="M6 12h12" />
    </svg>
  );
}

/**
 * The UPI mark: an orange arrow in front of a green one, both slanted like the logo. The green
 * one follows the text colour, so it still shows on a selected (green) button.
 */
export function UpiIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" stroke="none" {...props}>
      <path d="M11.5 3.5 20 13.5 9.5 21.5Z" fill="currentColor" />
      <path d="M7 2.5 15.5 12 5 20Z" fill="#F47920" />
    </svg>
  );
}

export const PAYMENT_ICON: Record<PaymentMethod, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  CASH: Banknote,
  UPI: UpiIcon,
  CARD: CreditCard,
};

const PAYMENT_CLASS: Record<PaymentMethod, string> = { CASH: 'badge-green', UPI: 'badge-purple', CARD: 'badge-blue' };

export function PaymentBadge({ method, amount }: { method: PaymentMethod; amount?: number }) {
  const Icon = PAYMENT_ICON[method];
  return (
    <span className={`badge ${PAYMENT_CLASS[method]}`}>
      <Icon />
      {PAYMENT_LABEL[method]}
      {amount !== undefined && <span className="num">{formatMoney(amount)}</span>}
    </span>
  );
}

/** How a bill was paid: one badge, or one per part (with its amount) for a split payment. */
export function PaymentBadges({ payments }: { payments: PaymentPart[] }) {
  if (payments.length === 1) return <PaymentBadge method={payments[0].method} />;
  return (
    <span className="pay-badges">
      {payments.map((p) => (
        <PaymentBadge key={p.method} method={p.method} amount={p.amount} />
      ))}
    </span>
  );
}

const STATUS_CLASS: Record<TransactionStatus, string> = { COMPLETED: 'badge-solid-green', VOIDED: 'badge-gray', REFUNDED: 'badge-red' };

export function TxStatusBadge({ status }: { status: TransactionStatus }) {
  return <span className={`badge badge-sm ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function TableBadge({ label, orderType }: { label: string; orderType: OrderType }) {
  if (!label) return <span className="badge badge-purple">{ORDER_TYPE_LABEL[orderType]}</span>;
  return <span className="badge badge-primary">{label}</span>;
}

export function ActiveBadge({ status }: { status: 'ACTIVE' | 'INACTIVE' }) {
  return <span className={`badge badge-sm ${status === 'ACTIVE' ? 'badge-green' : 'badge-gray'}`}>{status === 'ACTIVE' ? 'Active' : 'Inactive'}</span>;
}
