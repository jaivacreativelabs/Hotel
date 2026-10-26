import { PAYMENT_METHODS, TRANSACTION_STATUSES, type PaymentMethod, type TransactionDTO, type TransactionStatus } from '@rb/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Calendar, ChevronDown, Download, Eye, FileText, Pencil, Printer, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PaymentBadge, TableBadge, TxStatusBadge } from '../../components/badges';
import { FoodImage } from '../../components/FoodImage';
import { openReceipt } from '../../components/PaymentButtons';
import { CancelButton, ConfirmButton, Empty, Field, Loading, Modal, PageHeader, Pagination, SidePanel, Spinner } from '../../components/ui';
import { useDebounce } from '../../hooks/useDebounce';
import { api, downloadFile } from '../../services/api';
import { useAuth } from '../../store/auth';
import { useToast } from '../../store/toast';
import { usePageSearch, useTopbarExtra } from '../../store/topbar';
import { cx, formatDate, formatDateTime, formatDay, formatMoney, formatTime, PAYMENT_LABEL, presetRange, STATUS_LABEL, type DatePreset } from '../../utils/format';
import { BillEditor, useEditMinutesLeft } from './BillEditor';

const PRESETS: [DatePreset, string][] = [
  ['all', 'All Bills'],
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['week', 'This Week'],
  ['month', 'This Month'],
];

export function DateRangePicker({ from, to, active, onApply }: { from?: string; to?: string; active: boolean; onApply: (from: string, to: string) => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(from ?? '');
  const [t, setT] = useState(to ?? '');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className={cx('chip outline', active && 'active')} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Calendar /> {active && from && to ? `${formatDay(from)} – ${formatDay(to)}` : 'Select Date Range'} <ChevronDown />
      </button>
      {open && (
        <div className="date-range-pop">
          <Field label="From">{(id) => <input id={id} type="date" className="input input-sm" value={f} max={t || undefined} onChange={(e) => setF(e.target.value)} />}</Field>
          <Field label="To">{(id) => <input id={id} type="date" className="input input-sm" value={t} min={f || undefined} onChange={(e) => setT(e.target.value)} />}</Field>
          <button
            className="btn btn-primary btn-sm"
            disabled={!f || !t || f > t}
            onClick={() => {
              onApply(f, t);
              setOpen(false);
            }}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

function StatusChangeModal({ tx, kind, onClose, onDone }: { tx: TransactionDTO; kind: 'void' | 'refund'; onClose: () => void; onDone: (t: TransactionDTO) => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    try {
      onDone(await api.post<TransactionDTO>(`/transactions/${tx.id}/${kind}`, { reason: reason.trim() }, { branchId: null }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={kind === 'void' ? `Void bill #${tx.billNumber}?` : `Refund bill #${tx.billNumber}?`} onClose={onClose}>
      <p className="muted">
        {kind === 'void'
          ? 'Voiding marks the bill as cancelled. It stays in the history but no longer counts as a sale.'
          : `Refunding records that ${formatMoney(tx.grandTotal)} was returned to the customer. It no longer counts as a sale.`}{' '}
        The original amounts are never changed. This action is logged.
      </p>
      <Field label="Reason" error={error}>
        {(id) => <textarea id={id} className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Billed to the wrong table" />}
      </Field>
      <div className="modal-actions">
        <CancelButton onClick={onClose} disabled={busy} />
        <ConfirmButton onClick={submit} busy={busy} disabled={reason.trim().length < 3} label={kind === 'void' ? 'Void bill' : 'Refund bill'} />
      </div>
    </Modal>
  );
}

function BillDetails({
  tx,
  onClose,
  onChanged,
  onEdit,
  showBranch,
}: {
  tx: TransactionDTO;
  onClose: () => void;
  onChanged: (t: TransactionDTO) => void;
  onEdit: () => void;
  showBranch: boolean;
}) {
  const [change, setChange] = useState<'void' | 'refund' | null>(null);
  const toast = useToast();
  const { user } = useAuth();
  const anyTime = user?.role === 'SUPER_ADMIN';
  const minutesLeft = useEditMinutesLeft(tx.status === 'COMPLETED' && !anyTime ? tx.editableUntil : null);
  return (
    <SidePanel
      title="Bill Details"
      onClose={onClose}
      footer={
        <>
          {tx.status === 'COMPLETED' && (anyTime || minutesLeft > 0) && (
            <button className="btn btn-outline-primary btn-lg btn-block" onClick={onEdit}>
              <Pencil /> {anyTime ? 'Edit bill' : `Edit bill (${minutesLeft} min left)`}
            </button>
          )}
          <button className="btn btn-primary btn-lg btn-block" onClick={() => openReceipt(tx.id)}>
            <Printer /> Print Bill Again
          </button>
          {tx.status === 'COMPLETED' && (
            <div className="row" style={{ justifyContent: 'center', gap: 20 }}>
              <button className="link-btn danger" onClick={() => setChange('void')}>
                <Ban size={15} /> Void bill
              </button>
              <button className="link-btn danger" onClick={() => setChange('refund')}>
                <Undo2 size={15} /> Refund
              </button>
            </div>
          )}
        </>
      }
    >
      <div className="bill-number-box">
        <span>Bill No.</span>
        <strong>#{tx.billNumber}</strong>
        <span className="spacer" />
        <TxStatusBadge status={tx.status} />
      </div>
      <dl className="kv">
        <div>
          <dt>Date &amp; Time</dt>
          <dd>{formatDateTime(tx.finalizedAt)}</dd>
        </div>
        <div>
          <dt>Table</dt>
          <dd>
            <TableBadge label={tx.tableLabel} />
            {tx.groupName && <span className="cell-sub">{tx.groupName}</span>}
          </dd>
        </div>
        <div>
          <dt>Payment Mode</dt>
          <dd>
            <PaymentBadge method={tx.paymentMethod} />
          </dd>
        </div>
        <div>
          <dt>Cashier</dt>
          <dd>{tx.createdByName}</dd>
        </div>
        {tx.customerName && (
          <div>
            <dt>Customer</dt>
            <dd>{tx.customerName}</dd>
          </div>
        )}
        {showBranch && (
          <div>
            <dt>Branch</dt>
            <dd>
              {tx.restaurantSnapshot.name}
              <span className="cell-sub">{tx.branchSnapshot.name}</span>
            </dd>
          </div>
        )}
      </dl>
      {tx.editCount > 0 && tx.editedAt && (
        <div className="alert alert-info">
          <Pencil />
          <span>
            Edited {tx.editCount > 1 ? `${tx.editCount} times, last ` : ''}by {tx.editedByName} at {formatTime(tx.editedAt)}. The earlier version is kept in the records.
          </span>
        </div>
      )}
      {tx.statusChange && (
        <div className="alert alert-warning">
          <Ban />
          <span>
            {STATUS_LABEL[tx.status]} by {tx.statusChange.byName} on {formatDateTime(tx.statusChange.at)}: “{tx.statusChange.reason}”
          </span>
        </div>
      )}
      <hr className="divider" />
      <div>
        <div className="section-title">Items ({tx.items.length})</div>
        <div className="bill-items-list">
          {tx.items.map((i) => (
            <div key={i.menuItemId} className="bill-item-row">
              <div className="thumb thumb-sm">
                <FoodImage src={i.imageUrl} alt={i.name} />
              </div>
              <span>{i.name}</span>
              <span className="qty-col">x{i.quantity}</span>
              <span className="amt num">{formatMoney(i.lineTotal)}</span>
            </div>
          ))}
        </div>
      </div>
      {(tx.discount || tx.taxes.length > 0) && (
        <div className="bill-rows num">
          <div>
            <span>Subtotal</span>
            <span>{formatMoney(tx.subtotal)}</span>
          </div>
          {tx.discount && tx.discount.amount > 0 && (
            <div>
              <span>Discount</span>
              <span>− {formatMoney(tx.discount.amount)}</span>
            </div>
          )}
          {tx.taxes.map((t) => (
            <div key={t.name}>
              <span>
                {t.name} ({t.rateBps / 100}%){tx.pricesIncludeTax ? ' incl.' : ''}
              </span>
              <span>{formatMoney(t.amount)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="total-box num">
        <span>Total Amount</span>
        <strong>{formatMoney(tx.grandTotal)}</strong>
      </div>
      {change && (
        <StatusChangeModal
          tx={tx}
          kind={change}
          onClose={() => setChange(null)}
          onDone={(t) => {
            setChange(null);
            toast.success(`Bill #${t.billNumber} ${t.status === 'VOIDED' ? 'voided' : 'refunded'}`);
            onChanged(t);
          }}
        />
      )}
    </SidePanel>
  );
}

/**
 * Transaction history. `scopeFilters` lets the Super Admin page add restaurant/branch
 * selectors; for Restaurant Admins the active branch is applied automatically.
 */
export function TransactionsView({
  scope,
  scopeFilters,
  showBranch = false,
}: {
  scope: { restaurantId?: string; branchId?: string };
  scopeFilters?: ReactNode;
  showBranch?: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const search = usePageSearch('Search by bill number, table number or customer...');
  const q = useDebounce(search.trim(), 300);
  const [preset, setPreset] = useState<DatePreset>('today');
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('');
  const [status, setStatus] = useState<TransactionStatus | ''>('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TransactionDTO | null>(null);
  const [exporting, setExporting] = useState(false);

  const range = preset === 'custom' && custom ? custom : presetRange(preset);
  const query = useMemo(
    () => ({ ...scope, q, from: range.from, to: range.to, paymentMethod, status, page, limit: 20 }),
    [scope, q, range.from, range.to, paymentMethod, status, page],
  );
  const { restaurantId, branchId } = scope;
  useEffect(() => setPage(1), [q, range.from, range.to, paymentMethod, status, restaurantId, branchId]);

  const list = useQuery({
    queryKey: ['transactions', query],
    queryFn: () => api.page<TransactionDTO>('/transactions', { query, branchId: null }),
    placeholderData: keepPreviousData,
  });
  const selected = list.data?.data.find((t) => t.id === selectedId) ?? null;

  const extra = useMemo(
    () =>
      range.from && range.to ? (
        <span className="date-range-display">
          <Calendar size={20} />
          {formatDay(range.from)} – {formatDay(range.to)}
        </span>
      ) : null,
    [range.from, range.to],
  );
  useTopbarExtra(extra);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const { page: _p, limit: _l, ...filters } = query;
      await downloadFile('/transactions/export.csv', filters, 'transactions.csv');
    } catch (err) {
      toast.error(err);
    } finally {
      setExporting(false);
    }
  };

  if (editing) {
    return (
      <div className="tx-layout">
        <BillEditor
          key={editing.id}
          tx={editing}
          search={search}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ['transactions'] });
          }}
        />
      </div>
    );
  }

  return (
    <div className="tx-layout">
      <div className="page">
        <PageHeader
          title="Transactions"
          subtitle="View all past bills and payments"
          actions={
            <button className="btn btn-soft btn-lg" onClick={exportCsv} disabled={exporting}>
              {exporting ? <Spinner /> : <Download />} Export
            </button>
          }
        />
        <div className="filters">
          {PRESETS.map(([key, label]) => (
            <button key={key} className={cx('chip outline', preset === key && 'active')} onClick={() => setPreset(key)}>
              {label}
            </button>
          ))}
          <DateRangePicker
            from={custom?.from}
            to={custom?.to}
            active={preset === 'custom'}
            onApply={(from, to) => {
              setCustom({ from, to });
              setPreset('custom');
            }}
          />
        </div>
        <div className="filters">
          {scopeFilters}
          <select className="select select-sm" style={{ width: 180 }} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | '')} aria-label="Payment mode">
            <option value="">All payment modes</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_LABEL[m]}
              </option>
            ))}
          </select>
          <select className="select select-sm" style={{ width: 160 }} value={status} onChange={(e) => setStatus(e.target.value as TransactionStatus | '')} aria-label="Status">
            <option value="">All statuses</option>
            {TRANSACTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="card">
          {list.isLoading ? (
            <Loading label="Loading transactions…" />
          ) : list.isError ? (
            <Empty title="Could not load transactions">{(list.error as Error).message}</Empty>
          ) : list.data!.data.length === 0 ? (
            <Empty icon={<FileText />} title="No bills found">
              Try another date range or search.
            </Empty>
          ) : (
            <>
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Bill No.</th>
                      <th>Date &amp; Time</th>
                      {showBranch && <th>Branch</th>}
                      <th className="center">Table</th>
                      <th className="center">Items</th>
                      <th>Total Amount</th>
                      <th>Payment Mode</th>
                      <th className="center">Status</th>
                      <th className="center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data!.data.map((t) => (
                      <tr key={t.id} className={cx('clickable', t.id === selectedId && 'selected')} onClick={() => setSelectedId(t.id)}>
                        <td className="bill-no">
                          #{t.billNumber}
                          {t.editCount > 0 && <span className="cell-sub">Edited</span>}
                        </td>
                        <td className="nowrap">
                          {formatDate(t.finalizedAt)}
                          <span className="cell-sub">{formatTime(t.finalizedAt)}</span>
                        </td>
                        {showBranch && (
                          <td>
                            {t.branchSnapshot.name}
                            <span className="cell-sub">{t.restaurantSnapshot.name}</span>
                          </td>
                        )}
                        <td className="center">
                          <TableBadge label={t.tableLabel} />
                        </td>
                        <td className="center num">{t.itemCount}</td>
                        <td className="num nowrap">
                          <strong>{formatMoney(t.grandTotal)}</strong>
                        </td>
                        <td>
                          <PaymentBadge method={t.paymentMethod} />
                        </td>
                        <td className="center">
                          <TxStatusBadge status={t.status} />
                        </td>
                        <td className="center">
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedId(t.id);
                            }}
                          >
                            <Eye size={16} /> View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Phones: one card per bill instead of a wide table */}
              <ul className="tx-cards">
                {list.data!.data.map((t) => (
                  <li key={t.id}>
                    <button type="button" className={cx('tx-card', t.id === selectedId && 'selected')} onClick={() => setSelectedId(t.id)}>
                      <span className="tx-card-top">
                        <span className="bill-no">
                          #{t.billNumber}
                          {t.editCount > 0 && <small className="muted"> · Edited</small>}
                        </span>
                        <span className="tx-card-total num">{formatMoney(t.grandTotal)}</span>
                      </span>
                      <span className="tx-card-meta">
                        {formatDate(t.finalizedAt)} · {formatTime(t.finalizedAt)} · {t.itemCount} item{t.itemCount === 1 ? '' : 's'}
                        {showBranch && ` · ${t.branchSnapshot.name}`}
                      </span>
                      <span className="tx-card-badges">
                        <TableBadge label={t.tableLabel} />
                        <PaymentBadge method={t.paymentMethod} />
                        <TxStatusBadge status={t.status} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <Pagination meta={list.data!.meta} onPage={setPage} />
            </>
          )}
        </div>
      </div>
      {selected && (
        <BillDetails
          key={selected.id}
          tx={selected}
          showBranch={showBranch}
          onClose={() => setSelectedId(null)}
          onEdit={() => setEditing(selected)}
          onChanged={() => void queryClient.invalidateQueries({ queryKey: ['transactions'] })}
        />
      )}
    </div>
  );
}

export function TransactionsPage() {
  const { activeBranch } = useAuth();
  const scope = useMemo(() => ({ branchId: activeBranch!.id }), [activeBranch]);
  return <TransactionsView scope={scope} />;
}
