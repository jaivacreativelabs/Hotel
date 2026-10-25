import {
  LIMITS,
  TABLE_SHAPES,
  type DraftDTO,
  type TableDTO,
  type TableGroupSummaryDTO,
  type TableShape,
  type TableStatus,
  type TransactionDTO,
} from '@rb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { CirclePlus, FileText, Pencil, Plus, Trash2, Users, Utensils } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { TableIcon } from '../../components/badges';
import { FoodImage } from '../../components/FoodImage';
import { BillDoneModal, PaymentModal } from '../../components/PaymentButtons';
import { TableIllustration } from '../../components/TableIllustration';
import { CancelButton, ConfirmButton, ConfirmDialog, Empty, Field, Loading, PageHeader, SidePanel, Spinner, Stepper } from '../../components/ui';
import { api, ApiError, errorMessage } from '../../services/api';
import { tableKeys, useTables } from '../../services/queries';
import { useAuth } from '../../store/auth';
import { acquireDraftSync, releaseDraftSync } from '../../store/draftSync';
import { useToast } from '../../store/toast';
import { usePageSearch } from '../../store/topbar';
import { cx, formatMoney, newIdempotencyKey } from '../../utils/format';

const ALL_FLOORS = '__all__';
const GROUP_TAGS = ['Family', 'Friends', 'Couple', 'Business'];
const GROUP_COLORS = [
  ['#fff1cc', '#e5a800'],
  ['#fde4e4', '#e04848'],
  ['#e3eefc', '#2f6fdb'],
  ['#e5f4e9', '#1e9e45'],
];

function pillText(t: TableDTO) {
  switch (t.occupancy) {
    case 'AVAILABLE':
      return 'Available';
    case 'FULL':
      return 'Full';
    case 'RESERVED':
      return 'Reserved';
    default:
      return `${t.seatsUsed} / ${t.seats} Seats`;
  }
}

function TableCard({ table, selected, onClick }: { table: TableDTO; selected: boolean; onClick: () => void }) {
  return (
    <button className={cx('table-card', table.occupancy, selected && 'selected')} onClick={onClick} aria-pressed={selected}>
      <span className="table-label">{table.label}</span>
      <span className="table-seats">{table.seats} Seats</span>
      <TableIllustration shape={table.shape} seats={table.seats} tone={table.occupancy} />
      <span className={cx('status-pill', table.occupancy)}>{pillText(table)}</span>
    </button>
  );
}

// ---------------- Add / edit table ----------------

function TableForm({
  initial,
  floors,
  defaultFloor,
  suggestedLabel,
  onClose,
  onSaved,
}: {
  initial?: TableDTO;
  floors: string[];
  defaultFloor: string;
  suggestedLabel: string;
  onClose: () => void;
  onSaved: (t: TableDTO) => void;
}) {
  const toast = useToast();
  const [label, setLabel] = useState(initial?.label ?? '');
  const [seats, setSeats] = useState(initial?.seats ?? 4);
  const [shape, setShape] = useState<TableShape>(initial?.shape ?? 'SQUARE');
  const [floor, setFloor] = useState(initial?.floor ?? defaultFloor);
  const [status, setStatus] = useState<TableStatus>(initial?.status ?? 'AVAILABLE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const minSeats = Math.max(1, initial?.seatsUsed ?? 1);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { label: label.trim(), seats, shape, floor: floor.trim() || 'Ground Floor', status };
      const saved = initial ? await api.patch<TableDTO>(`/tables/${initial.id}`, body) : await api.post<TableDTO>('/tables', body);
      toast.success(initial ? `Table ${saved.label} updated` : `Table ${saved.label} added`);
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      await api.delete(`/tables/${initial!.id}`);
      toast.success(`Table ${initial!.label} removed`);
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setConfirmRemove(false);
    }
  };

  return (
    <SidePanel title={initial ? `Edit ${initial.label}` : 'Add Table'} onClose={onClose}>
      <form className="stack" style={{ gap: 22 }} onSubmit={submit}>
        <Field label="Table Number" error={error}>
          {(id) => (
            <input id={id} className="input" placeholder={`e.g. ${suggestedLabel}`} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={10} required autoFocus />
          )}
        </Field>
        <div className="field">
          <span className="field-label">Number of Seats</span>
          <Stepper label="seats" value={seats} min={minSeats} max={LIMITS.maxSeats} onChange={setSeats} />
          {initial && initial.seatsUsed > 0 && <span className="field-hint">{initial.seatsUsed} seats are in use right now.</span>}
        </div>
        <div className="field">
          <span className="field-label">Table Shape</span>
          <div className="shape-options" role="radiogroup" aria-label="Table shape">
            {TABLE_SHAPES.map((s) => (
              <button type="button" key={s} role="radio" aria-checked={shape === s} className={cx('shape-option', shape === s && 'active')} onClick={() => setShape(s)}>
                <TableIllustration shape={s} seats={4} tone="WOOD" />
                {s === 'SQUARE' ? 'Square' : 'Round'}
              </button>
            ))}
          </div>
        </div>
        <Field label="Floor">
          {(id) => (
            <>
              <input id={id} className="input" list="floor-options" value={floor} onChange={(e) => setFloor(e.target.value)} maxLength={40} required />
              <datalist id="floor-options">
                {floors.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label="Status">
          {(id) => (
            <div className="input-icon">
              <span className="dot" style={{ position: 'absolute', left: 16, top: 16, background: status === 'AVAILABLE' ? 'var(--status-available)' : 'var(--status-reserved)' }} />
              <select id={id} className="select" style={{ paddingLeft: 46 }} value={status} onChange={(e) => setStatus(e.target.value as TableStatus)}>
                <option value="AVAILABLE">Available</option>
                <option value="RESERVED">Reserved</option>
              </select>
            </div>
          )}
        </Field>
        <button className="btn btn-primary btn-lg btn-block" disabled={busy || !label.trim()}>
          {busy ? <Spinner /> : <CirclePlus />} {initial ? 'Save Changes' : 'Add Table'}
        </button>
        {initial && (
          <button type="button" className="btn btn-danger-soft btn-block" onClick={() => setConfirmRemove(true)} disabled={initial.groups.length > 0}>
            <Trash2 /> Remove table
          </button>
        )}
      </form>
      {confirmRemove && (
        <ConfirmDialog
          title={`Remove ${initial!.label}?`}
          message="The table disappears from the floor plan. Past bills keep their table number."
          confirmLabel="Remove"
          danger
          onCancel={() => setConfirmRemove(false)}
          onConfirm={remove}
        />
      )}
    </SidePanel>
  );
}

// ---------------- Table detail (groups) ----------------

function GroupCard({
  group,
  index,
  onAddItems,
  onGenerate,
  onDelete,
}: {
  group: TableGroupSummaryDTO;
  index: number;
  onAddItems: () => void;
  onGenerate: () => void;
  onDelete: () => void;
}) {
  const [bg, fg] = GROUP_COLORS[index % GROUP_COLORS.length];
  const extra = group.lineCount - group.previewItems.slice(0, 2).length;
  return (
    <div className="group-card">
      <div className="group-head">
        <div className="group-icon" style={{ background: bg, color: fg }}>
          <Users />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="group-name">{group.groupName}</div>
          <div className="muted">
            {group.guestCount} {group.guestCount === 1 ? 'Person' : 'People'}
          </div>
          {group.groupTag && (
            <span className="badge badge-blue badge-sm" style={{ marginTop: 6 }}>
              {group.groupTag}
            </span>
          )}
        </div>
        <div className="group-amount num">{formatMoney(group.grandTotal)}</div>
        <button className="icon-btn plain" onClick={onDelete} aria-label={`Delete ${group.groupName}`} title="Delete this group's bill">
          <Trash2 />
        </button>
      </div>
      <div className="group-items">
        {group.previewItems.length === 0 ? (
          <span className="muted">No items yet</span>
        ) : (
          <>
            {group.previewItems.slice(0, 2).map((p, i) => (
              <div className="thumb" key={i} style={{ width: 48, height: 48 }} title={p.name}>
                <FoodImage src={p.imageUrl} alt={p.name} />
              </div>
            ))}
            {extra > 0 && <span className="group-more">+{extra}</span>}
          </>
        )}
      </div>
      <div className="group-actions">
        <button className="btn btn-outline-primary" onClick={onAddItems}>
          <Utensils /> Add Items
        </button>
        <button className="btn btn-primary" onClick={onGenerate} disabled={group.itemCount === 0}>
          <FileText /> Generate Bill
        </button>
      </div>
    </div>
  );
}

function NewGroupForm({ free, busy, onCreate, onCancel }: { free: number; busy: boolean; onCreate: (guests: number, tag: string, openBill: boolean) => void; onCancel: () => void }) {
  const [guests, setGuests] = useState(Math.min(2, free));
  const [tag, setTag] = useState('');
  return (
    <div className="group-card">
      <div className="group-name">New group</div>
      <div className="field">
        <span className="field-label">Guests</span>
        <Stepper label="guests" value={guests} min={1} max={free} onChange={setGuests} />
      </div>
      <div className="field">
        <span className="field-label">Tag (optional)</span>
        <div className="tag-options">
          {GROUP_TAGS.map((t) => (
            <button type="button" key={t} className={cx('chip chip-sm', tag === t && 'active')} onClick={() => setTag(tag === t ? '' : t)}>
              {t}
            </button>
          ))}
        </div>
        <input className="input input-sm" placeholder="or type a tag" value={tag} maxLength={30} onChange={(e) => setTag(e.target.value)} />
      </div>
      <div className="group-actions">
        <CancelButton onClick={onCancel} disabled={busy} />
        <ConfirmButton onClick={() => onCreate(guests, tag.trim(), true)} busy={busy} label="Add food" />
      </div>
      <button className="link-btn" style={{ alignSelf: 'center' }} onClick={() => onCreate(guests, tag.trim(), false)} disabled={busy}>
        Just seat the group
      </button>
    </div>
  );
}

function TableDetail({ table, onClose, onEdit }: { table: TableDTO; onClose: () => void; onEdit: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { activeBranch } = useAuth();
  const branchId = activeBranch!.id;
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState<TableGroupSummaryDTO | null>(null);
  const [deleting, setDeleting] = useState<TableGroupSummaryDTO | null>(null);
  const [done, setDone] = useState<TransactionDTO | null>(null);
  const free = Math.max(0, table.seats - table.seatsUsed);
  const refresh = () => queryClient.invalidateQueries({ queryKey: tableKeys.list(branchId) });

  const createGroup = async (guestCount: number, groupTag: string, openBill: boolean) => {
    setBusy(true);
    try {
      const d = await api.post<DraftDTO>('/bills/table-groups', { tableId: table.id, guestCount, ...(groupTag && { groupTag }) });
      setAdding(false);
      await refresh();
      if (openBill) navigate(`/billing?draft=${d.id}`);
      else toast.success(`${d.groupName} seated at ${table.label}`);
    } catch (err) {
      toast.error(err);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  /** Uses the draft's sync engine so unsaved edits are flushed and the latest version is used. */
  const withLatestDraft = async <T,>(draftId: string, fn: (d: DraftDTO) => Promise<T>): Promise<T> => {
    const sync = acquireDraftSync(draftId, branchId);
    try {
      await sync.load();
      await sync.flushNow();
      const d = sync.getState().draft;
      if (!d) throw new Error(sync.getState().message ?? 'Could not load this bill');
      return await fn(d);
    } finally {
      releaseDraftSync(sync);
    }
  };

  const generate = async (group: TableGroupSummaryDTO, paymentMethod: string) => {
    try {
      const res = await withLatestDraft(group.draftId, (d) =>
        api.post<{ transaction: TransactionDTO }>(`/bills/${d.id}/finalize`, { version: d.version, paymentMethod, idempotencyKey: newIdempotencyKey() }),
      );
      setPaying(null);
      setDone(res.transaction);
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    } catch (err) {
      toast.error(err);
      if (err instanceof ApiError && err.status === 409) setPaying(null);
    } finally {
      await refresh();
    }
  };

  const removeGroup = async (group: TableGroupSummaryDTO) => {
    try {
      await withLatestDraft(group.draftId, (d) => api.delete(`/bills/${d.id}`, { query: { version: d.version } }));
      toast.success(`${group.groupName}'s bill deleted`);
    } catch (err) {
      toast.error(err);
    } finally {
      setDeleting(null);
      await refresh();
    }
  };

  const markAvailable = async () => {
    try {
      await api.patch(`/tables/${table.id}`, { status: 'AVAILABLE' });
      await refresh();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <SidePanel
      title={`Table ${table.label}`}
      subtitle={
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span className="nowrap">
            Capacity: {table.seats} Seats · {table.floor}
          </span>
          <span className="seats-chip" style={{ marginLeft: 0 }}>
            {table.seatsUsed} / {table.seats} Seats Used
          </span>
        </div>
      }
      onClose={onClose}
      footer={
        <div className="row">
          <button className="link-btn" onClick={onEdit}>
            <Pencil size={15} /> Edit table
          </button>
        </div>
      }
    >
      {table.status === 'RESERVED' && table.groups.length === 0 && (
        <div className="alert alert-warning">
          <TableIcon width={18} height={18} />
          <div className="stack" style={{ gap: 8 }}>
            <span>This table is reserved. Mark it available when the guests arrive.</span>
            <button className="btn btn-sm btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={markAvailable}>
              Mark as Available
            </button>
          </div>
        </div>
      )}

      {table.groups.map((g, i) => (
        <GroupCard
          key={g.draftId}
          group={g}
          index={i}
          onAddItems={() => navigate(`/billing?draft=${g.draftId}`)}
          onGenerate={() => setPaying(g)}
          onDelete={() => setDeleting(g)}
        />
      ))}

      {adding ? (
        <NewGroupForm free={free} busy={busy} onCreate={createGroup} onCancel={() => setAdding(false)} />
      ) : (
        <button className="add-group" onClick={() => setAdding(true)} disabled={free === 0 || table.status === 'RESERVED'}>
          <span className="plus">
            <Plus size={30} />
          </span>
          <span>
            <strong>Add New Group</strong>
            <small>
              ({free} seat{free === 1 ? '' : 's'} available)
            </small>
          </span>
        </button>
      )}

      <div className="seat-summary">
        <Users />
        <div>
          <strong>Available Seats: {free}</strong>
          <div className="muted">
            {free === 0 ? 'This table is full.' : `You can add ${free} more ${free === 1 ? 'person' : 'people'} to this table.`}
          </div>
        </div>
      </div>

      {paying && (
        <PaymentModal
          title={`Generate bill · ${table.label} ${paying.groupName}`}
          amount={paying.grandTotal}
          onClose={() => setPaying(null)}
          onConfirm={(m) => generate(paying, m)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.groupName}'s bill?`}
          message={
            deleting.itemCount > 0
              ? `This open bill has ${deleting.itemCount} item(s) worth ${formatMoney(deleting.grandTotal)}. Deleting it frees the seats and cannot be undone. Completed bills are not affected.`
              : 'The group will be removed and its seats freed.'
          }
          confirmLabel="Delete bill"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => removeGroup(deleting)}
        />
      )}
      {done && <BillDoneModal tx={done} onClose={() => setDone(null)} />}
    </SidePanel>
  );
}

// ---------------- Page ----------------

export function TablesPage() {
  const { activeBranch } = useAuth();
  const branchId = activeBranch!.id;
  const tables = useTables(branchId);
  const queryClient = useQueryClient();
  const search = usePageSearch('Search tables...');
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('table');
  const panel = params.get('panel'); // 'add' | 'edit'
  const [floor, setFloor] = useState<string>(ALL_FLOORS);

  const floors = tables.data?.floors ?? [];
  const effectiveFloor = floor !== ALL_FLOORS && !floors.includes(floor) ? ALL_FLOORS : floor;
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (tables.data?.tables ?? []).filter((t) => (effectiveFloor === ALL_FLOORS || t.floor === effectiveFloor) && (!q || t.label.toLowerCase().includes(q)));
  }, [tables.data, effectiveFloor, search]);
  const selected = tables.data?.tables.find((t) => t.id === selectedId) ?? null;

  const suggestedLabel = useMemo(() => {
    const nums = (tables.data?.tables ?? []).map((t) => Number(/(\d+)$/.exec(t.label)?.[1] ?? 0));
    return `T${String(Math.max(0, ...nums) + 1).padStart(2, '0')}`;
  }, [tables.data]);

  const setPanel = (next: { table?: string | null; panel?: string | null }) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p, { replace: true });
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey: tableKeys.list(branchId) });

  return (
    <>
      <div className="page">
        <PageHeader
          title="Tables"
          subtitle="View and manage restaurant tables"
          actions={
            <>
              <select className="select" style={{ width: 200 }} value={effectiveFloor} onChange={(e) => setFloor(e.target.value)} aria-label="Floor">
                <option value={ALL_FLOORS}>All Floors</option>
                {floors.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <button className="btn btn-primary btn-lg" onClick={() => setPanel({ panel: 'add', table: null })}>
                <CirclePlus /> Add Table
              </button>
            </>
          }
        />
        <div className="legend">
          <span>
            <i className="dot" style={{ background: 'var(--status-available)' }} /> Available
          </span>
          <span>
            <i className="dot" style={{ background: 'var(--status-partial)' }} /> Partially Occupied
          </span>
          <span>
            <i className="dot" style={{ background: 'var(--status-full)' }} /> Full
          </span>
          <span>
            <i className="dot" style={{ background: 'var(--status-reserved)' }} /> Reserved
          </span>
        </div>
        {tables.isLoading ? (
          <Loading label="Loading tables…" />
        ) : tables.isError ? (
          <Empty title="Could not load tables">{errorMessage(tables.error)}</Empty>
        ) : visible.length === 0 ? (
          <Empty icon={<TableIcon />} title={search ? 'No tables match your search' : 'No tables yet'}>
            {!search && 'Use “Add Table” to build your floor plan.'}
          </Empty>
        ) : (
          <div className="tables-grid">
            {visible.map((t) => (
              <TableCard key={t.id} table={t} selected={t.id === selectedId} onClick={() => setPanel({ table: t.id, panel: null })} />
            ))}
          </div>
        )}
      </div>

      {panel === 'add' && (
        <TableForm
          floors={floors}
          defaultFloor={effectiveFloor === ALL_FLOORS ? (floors[0] ?? 'Ground Floor') : effectiveFloor}
          suggestedLabel={suggestedLabel}
          onClose={() => setPanel({ panel: null })}
          onSaved={(t) => {
            void refresh();
            setPanel({ panel: null, table: t.id });
          }}
        />
      )}
      {panel === 'edit' && selected && (
        <TableForm
          key={selected.id}
          initial={selected}
          floors={floors}
          defaultFloor={selected.floor}
          suggestedLabel={suggestedLabel}
          onClose={() => {
            void refresh();
            setPanel({ panel: null, table: null });
          }}
          onSaved={() => {
            void refresh();
            setPanel({ panel: null });
          }}
        />
      )}
      {!panel && selected && (
        <TableDetail key={selected.id} table={selected} onClose={() => setPanel({ table: null })} onEdit={() => setPanel({ panel: 'edit' })} />
      )}
    </>
  );
}
