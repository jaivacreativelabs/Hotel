import type { PaymentMethod, TransactionStatus } from '@rb/shared';
import { Banknote, CreditCard, Smartphone } from 'lucide-react';
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

export const PAYMENT_ICON: Record<PaymentMethod, typeof Banknote> = { CASH: Banknote, UPI: Smartphone, CARD: CreditCard };

const PAYMENT_CLASS: Record<PaymentMethod, string> = { CASH: 'badge-green', UPI: 'badge-purple', CARD: 'badge-blue' };

export function PaymentBadge({ method }: { method: PaymentMethod }) {
  const Icon = PAYMENT_ICON[method];
  return (
    <span className={`badge ${PAYMENT_CLASS[method]}`}>
      <Icon />
      {PAYMENT_LABEL[method]}
    </span>
  );
}

const STATUS_CLASS: Record<TransactionStatus, string> = { COMPLETED: 'badge-solid-green', VOIDED: 'badge-gray', REFUNDED: 'badge-red' };

export function TxStatusBadge({ status }: { status: TransactionStatus }) {
  return <span className={`badge badge-sm ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function TableBadge({ label }: { label: string }) {
  if (!label) return <span className="badge badge-purple">Takeaway</span>;
  return <span className="badge badge-primary">{label}</span>;
}

export function ActiveBadge({ status }: { status: 'ACTIVE' | 'INACTIVE' }) {
  return <span className={`badge badge-sm ${status === 'ACTIVE' ? 'badge-green' : 'badge-gray'}`}>{status === 'ACTIVE' ? 'Active' : 'Inactive'}</span>;
}
