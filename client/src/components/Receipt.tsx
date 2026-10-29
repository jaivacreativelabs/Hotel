/**
 * A printable receipt (80 mm thermal friendly). Printing never creates a transaction – it only
 * reads the stored, immutable bill.
 */
import { ORDER_TYPE_LABEL, type TransactionDTO } from '@rb/shared';
import { formatDateTime, formatMoney, itemTaxShares, itemTaxText, PAYMENT_LABEL, STATUS_LABEL } from '../utils/format';

export const RECEIPT_CSS = `
.receipt { width: 72mm; margin: 0 auto; padding: 8px 0; font-family: 'Courier New', ui-monospace, monospace; font-size: 12px; color: #000; line-height: 1.35; }
.receipt .logo { display: block; width: 22mm; height: 22mm; margin: 0 auto 4px; border-radius: 50%; object-fit: cover; }
.receipt h1 { font-size: 16px; text-align: center; margin: 0; font-family: inherit; }
.receipt .c { text-align: center; }
.receipt .rule { border-top: 1px dashed #000; margin: 6px 0; }
.receipt table { width: 100%; border-collapse: collapse; }
.receipt td { padding: 1px 0; vertical-align: top; }
.receipt .r { text-align: right; white-space: nowrap; }
.receipt .total td { font-weight: bold; font-size: 14px; padding-top: 4px; }
.receipt .stamp { border: 2px solid #000; text-align: center; font-weight: bold; padding: 2px; margin: 6px 0; }
`;

/** `onLogoDone` fires once the logo has loaded or failed, so printing never misses it. */
export function Receipt({ t, onLogoDone }: { t: TransactionDTO; onLogoDone: () => void }) {
  const taxShares = itemTaxShares(t.taxes, t.items);
  return (
    <div className="receipt">
      {t.restaurantSnapshot.logoUrl && (
        <img className="logo" src={t.restaurantSnapshot.logoUrl} alt="" onLoad={onLogoDone} onError={onLogoDone} />
      )}
      <h1>{t.restaurantSnapshot.name}</h1>
      <div className="c">{t.branchSnapshot.name}</div>
      {t.branchSnapshot.address && <div className="c">{t.branchSnapshot.address}</div>}
      {(t.branchSnapshot.phone || t.restaurantSnapshot.phone) && <div className="c">Ph: {t.branchSnapshot.phone || t.restaurantSnapshot.phone}</div>}
      {t.restaurantSnapshot.gstin && <div className="c">GSTIN: {t.restaurantSnapshot.gstin}</div>}
      <div className="rule" />
      <table>
        <tbody>
          <tr>
            <td>Bill: {t.billNumber}</td>
            <td className="r">{t.tableLabel ? `Table ${t.tableLabel}` : ORDER_TYPE_LABEL[t.orderType]}</td>
          </tr>
          <tr>
            <td colSpan={2}>{formatDateTime(t.finalizedAt)}</td>
          </tr>
          {t.editCount > 0 && t.editedAt && (
            <tr>
              <td colSpan={2}>Revised: {formatDateTime(t.editedAt)}</td>
            </tr>
          )}
          {t.customerName && (
            <tr>
              <td colSpan={2}>Customer: {t.customerName}</td>
            </tr>
          )}
          <tr>
            <td colSpan={2}>Cashier: {t.createdByName}</td>
          </tr>
        </tbody>
      </table>
      {t.status !== 'COMPLETED' && <div className="stamp">{STATUS_LABEL[t.status].toUpperCase()}</div>}
      <div className="rule" />
      <table>
        <tbody>
          <tr>
            <td>
              <b>Item</b>
            </td>
            <td className="r">
              <b>Qty</b>
            </td>
            <td className="r">
              <b>Amount</b>
            </td>
          </tr>
          {t.items.map((i, n) => (
            <tr key={i.menuItemId}>
              <td>
                {i.name}
                <br />@ {formatMoney(i.unitPrice)}
                {itemTaxText(i) && (t.pricesIncludeTax ? ` (incl. ${itemTaxText(i)})` : ` + ${itemTaxText(i)}`)}
              </td>
              <td className="r">{i.quantity}</td>
              <td className="r">{formatMoney(i.lineTotal + (t.pricesIncludeTax ? 0 : taxShares[n]))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="rule" />
      <table>
        <tbody>
          <tr>
            <td>Subtotal</td>
            {/* Taxes are inside each item's amount, so the subtotal includes them too. */}
            <td className="r">{formatMoney(t.subtotal + (t.pricesIncludeTax ? 0 : t.taxTotal))}</td>
          </tr>
          {t.discount && t.discount.amount > 0 && (
            <tr>
              <td>Discount</td>
              <td className="r">-{formatMoney(t.discount.amount)}</td>
            </tr>
          )}
          <tr className="total">
            <td>TOTAL</td>
            <td className="r">{formatMoney(t.grandTotal)}</td>
          </tr>
          <tr>
            <td>Paid by</td>
            <td className="r">{PAYMENT_LABEL[t.paymentMethod]}</td>
          </tr>
        </tbody>
      </table>
      <div className="rule" />
      {t.restaurantSnapshot.receiptFooter && <div className="c">{t.restaurantSnapshot.receiptFooter}</div>}
    </div>
  );
}
