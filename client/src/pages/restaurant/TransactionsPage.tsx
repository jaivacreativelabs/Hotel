import { PAYMENT_METHODS, TRANSACTION_STATUSES, type PaymentMethod, type TransactionDTO, type TransactionStatus } from '@rb/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Calendar, ChevronDown, Download, FileText, Pencil, Printer, ShoppingBag, SquareArrowOutUpRight, Undo2, UtensilsCrossed } from 'lucide-react';
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
import { cx, formatDate, formatDateTime, formatDay, formatMoney, formatTime, isoDay, PAYMENT_LABEL, presetRange, shiftDays, STATUS_LABEL, itemTaxShares, itemTaxText, type DatePreset } from '../../utils/format';
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
  const taxShares = itemTaxShares(tx.taxes, tx.items);
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
            {STATUS_LABEL[tx.status]} by {tx.statusChange.byName} on {formatDateTime(tx.statusChange.at)}
            <br />
            <strong>Reason:</strong> {tx.statusChange.reason}
          </span>
        </div>
      )}
      <hr className="divider" />
      <div>
        <div className="section-title">Items ({tx.items.length})</div>
        <div className="bill-items-list">
          {tx.items.map((i, n) => (
            <div key={i.menuItemId} className="bill-item-row">
              <div className="thumb thumb-sm">
                <FoodImage src={i.imageUrl} alt={i.name} />
              </div>
              <span>
                {i.name}
                {/* Taxes are shown inside the item's amount, not as separate lines */}
                {itemTaxText(i) && <small className="bill-item-tax">{tx.pricesIncludeTax ? `incl. ${itemTaxText(i)}` : `+ ${itemTaxText(i)}`}</small>}
              </span>
              <span className="qty-col">x{i.quantity}</span>
              <span className="amt num">{formatMoney(i.lineTotal + (tx.pricesIncludeTax ? 0 : taxShares[n]))}</span>
            </div>
          ))}
        </div>
      </div>
      {tx.discount && tx.discount.amount > 0 && (
        <div className="bill-rows num">
          <div>
            <span>Subtotal</span>
            <span>{formatMoney(tx.subtotal + (tx.pricesIncludeTax ? 0 : tx.taxTotal))}</span>
          </div>
          <div>
            <span>Discount</span>
            <span>− {formatMoney(tx.discount.amount)}</span>
          </div>
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

const dayHeadingFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

/** Bills grouped by the local day they were paid, newest first (the API already sorts them). */
function groupByDay(txs: TransactionDTO[]): { day: string; label: string; txs: TransactionDTO[] }[] {
  const today = isoDay(new Date());
  const yesterday = isoDay(shiftDays(new Date(), -1));
  const groups: { day: string; label: string; txs: TransactionDTO[] }[] = [];
  for (const t of txs) {
    const day = isoDay(new Date(t.finalizedAt));
    let g = groups[groups.length - 1];
    if (!g || g.day !== day) {
      const label = day === today ? 'Today' : day === yesterday ? 'Yesterday' : dayHeadingFmt.format(new Date(`${day}T00:00:00`));
      g = { day, label, txs: [] };
      groups.push(g);
    }
    g.txs.push(t);
  }
  return groups;
}

const CARD_ITEMS = 3;

function TxCard({
  tx,
  selected,
  showBranch,
  onOpen,
  onEdit,
  onChange,
}: {
  tx: TransactionDTO;
  selected: boolean;
  showBranch: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onChange: (kind: 'void' | 'refund') => void;
}) {
  const { user } = useAuth();
  const anyTime = user?.role === 'SUPER_ADMIN';
  const completed = tx.status === 'COMPLETED';
  const minutesLeft = useEditMinutesLeft(completed && !anyTime ? tx.editableUntil : null);
  const canEdit = completed && (anyTime || minutesLeft > 0);
  const takeaway = !tx.tableLabel;
  const TypeIcon = takeaway ? ShoppingBag : UtensilsCrossed;
  const hidden = tx.items.length - CARD_ITEMS;
  const taxShares = itemTaxShares(tx.taxes, tx.items); // each item's amount includes its tax
  return (
    <article className={cx('bill-card', selected && 'selected', !completed && 'closed')}>
      <header className="bill-card-head">
        <span className={cx('bill-card-icon', takeaway && 'takeaway')}>
          <TypeIcon />
        </span>
        {tx.editCount > 0 && <span className="badge badge-sm badge-gray">Edited</span>}
        <span className="spacer" />
        <TxStatusBadge status={tx.status} />
      </header>
      <div>
        <div className="bill-card-title">{tx.customerName || (takeaway ? 'Takeaway' : `Table ${tx.tableLabel}`)}</div>
        <div className="bill-card-sub">
          #{tx.billNumber} / {takeaway ? 'Takeaway' : 'Dine in'}
          {tx.groupName && ` · ${tx.groupName}`}
          {showBranch && ` · ${tx.branchSnapshot.name}`}
        </div>
      </div>
      <div className="bill-card-when">
        <span>{formatDate(tx.finalizedAt)}</span>
        <span>{formatTime(tx.finalizedAt)}</span>
      </div>
      <table className="bill-card-items">
        <thead>
          <tr>
            <th>Order items</th>
            <th className="center">Qty</th>
            <th className="right">Price</th>
          </tr>
        </thead>
        <tbody>
          {tx.items.slice(0, CARD_ITEMS).map((i, n) => (
            <tr key={i.menuItemId}>
              <td>{i.name}</td>
              <td className="center num">{i.quantity}</td>
              <td className="right num">{formatMoney(i.lineTotal + (tx.pricesIncludeTax ? 0 : taxShares[n]))}</td>
            </tr>
          ))}
          {hidden > 0 && (
            <tr>
              <td colSpan={3} className="bill-card-more">
                + {hidden} more item{hidden === 1 ? '' : 's'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="bill-card-total">
        <span>Total</span>
        <span className="spacer" />
        <PaymentBadge method={tx.paymentMethod} />
        <strong className="num">{formatMoney(tx.grandTotal)}</strong>
      </div>
      <footer className="bill-card-actions">
        <button type="button" className="link-btn" onClick={onOpen}>
          <SquareArrowOutUpRight size={15} /> See details
        </button>
        <span className="spacer" />
        <button type="button" className="icon-btn" onClick={() => openReceipt(tx.id)} aria-label={`Print bill #${tx.billNumber}`} title="Print bill">
          <Printer />
        </button>
        {canEdit && (
          <button type="button" className="icon-btn" onClick={onEdit} aria-label={`Edit bill #${tx.billNumber}`} title={anyTime ? 'Edit bill' : `Edit bill (${minutesLeft} min left)`}>
            <Pencil />
          </button>
        )}
        {completed && (
          <>
            <button type="button" className="icon-btn danger" onClick={() => onChange('void')} aria-label={`Void bill #${tx.billNumber}`} title="Void bill">
              <Ban />
            </button>
            <button type="button" className="icon-btn danger" onClick={() => onChange('refund')} aria-label={`Refund bill #${tx.billNumber}`} title="Refund">
              <Undo2 />
            </button>
          </>
        )}
      </footer>
    </article>
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
  const [change, setChange] = useState<{ tx: TransactionDTO; kind: 'void' | 'refund' } | null>(null);
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

        {list.isLoading ? (
          <div className="card">
            <Loading label="Loading transactions…" />
          </div>
        ) : list.isError ? (
          <div className="card">
            <Empty title="Could not load transactions">{(list.error as Error).message}</Empty>
          </div>
        ) : list.data!.data.length === 0 ? (
          <div className="card">
            <Empty icon={<FileText />} title="No bills found">
              Try another date range or search.
            </Empty>
          </div>
        ) : (
          <>
            {groupByDay(list.data!.data).map((g) => (
              <section key={g.day} className="bill-day">
                <h2 className="bill-day-title">{g.label}</h2>
                <div className="bill-grid">
                  {g.txs.map((t) => (
                    <TxCard
                      key={t.id}
                      tx={t}
                      selected={t.id === selectedId}
                      showBranch={showBranch}
                      onOpen={() => setSelectedId(t.id)}
                      onEdit={() => setEditing(t)}
                      onChange={(kind) => setChange({ tx: t, kind })}
                    />
                  ))}
                </div>
              </section>
            ))}
            <Pagination meta={list.data!.meta} onPage={setPage} />
          </>
        )}
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
      {change && (
        <StatusChangeModal
          tx={change.tx}
          kind={change.kind}
          onClose={() => setChange(null)}
          onDone={(t) => {
            setChange(null);
            toast.success(`Bill #${t.billNumber} ${t.status === 'VOIDED' ? 'voided' : 'refunded'}`);
            void queryClient.invalidateQueries({ queryKey: ['transactions'] });
          }}
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
