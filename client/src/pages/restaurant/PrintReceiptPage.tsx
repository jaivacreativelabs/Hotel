/** The receipt on a page of its own (opened from a link); prints itself with ?autoprint=1. */
import type { TransactionDTO } from '@rb/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Receipt, RECEIPT_CSS } from '../../components/Receipt';
import { api, errorMessage } from '../../services/api';

const css = `
@page { margin: 0; }
body { background: #fff !important; }
${RECEIPT_CSS}
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
      <Receipt t={t} />
      <div className="print-actions">
        <button className="btn btn-primary" onClick={() => window.print()}>
          Print
        </button>
      </div>
    </>
  );
}
