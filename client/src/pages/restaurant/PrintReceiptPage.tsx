/**
 * Printable receipt (80 mm thermal friendly). Printing never creates a transaction – it only
 * reads the stored, immutable bill.
 */
import type { TransactionDTO } from '@rb/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../services/api';
import { formatDateTime, formatMoney, PAYMENT_LABEL, STATUS_LABEL } from '../../utils/format';

const css = `
@page { size: 80mm auto; margin: 4mm; }
body { background: #fff !important; }
.receipt { width: 72mm; margin: 0 auto; padding: 8px 0; font-family: 'Courier New', ui-monospace, monospace; font-size: 12px; color: #000; line-height: 1.35; }
.receipt h1 { font-size: 16px; text-align: center; margin: 0; font-family: inherit; }
.receipt .c { text-align: center; }
.receipt .rule { border-top: 1px dashed #000; margin: 6px 0; }
.receipt table { width: 100%; border-collapse: collapse; }
.receipt td { padding: 1px 0; vertical-align: top; }
.receipt .r { text-align: right; white-space: nowrap; }
.receipt .total td { font-weight: bold; font-size: 14px; padding-top: 4px; }
.receipt .stamp { border: 2px solid #000; text-align: center; font-weight: bold; padding: 2px; margin: 6px 0; }
.print-actions { text-align: center; margin: 16px; font-family: var(--font-family); }
@media print { .print-actions { display: none; } }
`;

export function PrintReceiptPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const tx = useQuery({
    queryKey: ['transaction', id],
    queryFn: () => api.get<TransactionDTO>(`/transactions/${id}`, { branchId: null }),
  });

  useEffect(() => {
    if (tx.data && params.get('autoprint') === '1') {
      const t = setTimeout(() => window.print(), 300);
      return () => clearTimeout(t);
    }
  }, [tx.data, params]);

  if (tx.isLoading) return <p style={{ padding: 20 }}>Loading bill…</p>;
  if (tx.isError) return <p style={{ padding: 20 }}>Could not load this bill: {errorMessage(tx.error)}</p>;
  const t = tx.data!;

  return (
    <>
      <style>{css}</style>
      <div className="receipt">
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
              <td className="r">{t.tableLabel ? `Table ${t.tableLabel}` : 'Takeaway'}</td>
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
            {t.items.map((i) => (
              <tr key={i.menuItemId}>
                <td>
                  {i.name}
                  <br />@ {formatMoney(i.unitPrice)}
                </td>
                <td className="r">{i.quantity}</td>
                <td className="r">{formatMoney(i.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="rule" />
        <table>
          <tbody>
            <tr>
              <td>Subtotal</td>
              <td className="r">{formatMoney(t.subtotal)}</td>
            </tr>
            {t.discount && t.discount.amount > 0 && (
              <tr>
                <td>Discount</td>
                <td className="r">-{formatMoney(t.discount.amount)}</td>
              </tr>
            )}
            {t.taxes.map((x) => (
              <tr key={x.name}>
                <td>
                  {x.name} {x.rateBps / 100}%{t.pricesIncludeTax ? ' (incl.)' : ''}
                </td>
                <td className="r">{formatMoney(x.amount)}</td>
              </tr>
            ))}
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
      <div className="print-actions">
        <button className="btn btn-primary" onClick={() => window.print()}>
          Print
        </button>
      </div>
    </>
  );
}
