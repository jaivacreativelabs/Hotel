import type { PaymentMethod } from './constants.js';

/** One part of a bill paid in more than one way, e.g. ₹200 cash + ₹50 UPI. Amounts in paise. */
export interface PaymentPart {
  method: PaymentMethod;
  amount: number;
}

/** The mode that took the most money – a split bill's `paymentMethod`. */
export function mainPaymentMethod(parts: PaymentPart[]): PaymentMethod {
  return parts.reduce((a, b) => (b.amount > a.amount ? b : a)).method;
}
