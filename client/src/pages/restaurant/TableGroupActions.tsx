/**
 * Move / Merge / Split for a group seated at a table. Each opens a small dialog; the server
 * checks seats and versions again and keeps what was already sent to the kitchen.
 */
import type { TableDTO, TableGroupSummaryDTO } from '@rb/shared';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { FoodImage } from '../../components/FoodImage';
import { TableIllustration } from '../../components/TableIllustration';
import { CancelButton, ConfirmButton, Field, Loading, Modal, Stepper } from '../../components/ui';
import { useDraftSync } from '../../hooks/useDraftSync';
import { cx, formatMoney } from '../../utils/format';

export type GroupAction = 'move' | 'merge' | 'split';

const freeSeats = (t: TableDTO) => t.seats - t.seatsUsed;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Pick a table with enough free seats for the whole group. */
export function MoveGroupModal({
  group,
  table,
  tables,
  onClose,
  onConfirm,
}: {
  group: TableGroupSummaryDTO;
  table: TableDTO;
  tables: TableDTO[];
  onClose: () => void;
  onConfirm: (tableId: string) => Promise<void>;
}) {
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const others = tables.filter((t) => t.id !== table.id);
  const chosen = others.find((t) => t.id === target);
  return (
    <Modal title={`Move ${group.groupName} to another table`} onClose={busy ? () => undefined : onClose} width={900}>
      <div className="move-flow">
        {/* Move from: the table the group sits at now */}
        <div className="move-side">
          <div className="move-side-title">Move from</div>
          <div className="move-table from">
            <TableIllustration shape={table.shape} seats={table.seats} tone={table.occupancy} className="table-illus-lg" />
            <strong>{table.label}</strong>
            <span className="muted">
              {group.groupName} · {plural(group.guestCount, 'guest')}
            </span>
          </div>
        </div>

        <div className="move-arrow" aria-hidden="true">
          <ArrowRight />
        </div>

        {/* Move to: pick a table; once picked, only that table is shown */}
        <div className="move-side to">
          <div className="move-side-title">
            Move to
            {chosen && (
              <button type="button" className="link-btn" onClick={() => setTarget(null)} disabled={busy}>
                Change
              </button>
            )}
          </div>
          {chosen ? (
            <div className="move-table chosen">
              <TableIllustration shape={chosen.shape} seats={chosen.seats} tone={chosen.occupancy} className="table-illus-lg" />
              <strong>{chosen.label}</strong>
              <span className="muted">
                {freeSeats(chosen)} of {chosen.seats} seats free · {chosen.floor}
              </span>
            </div>
          ) : (
            <div className="pick-grid pick-grid-tables" role="radiogroup" aria-label="Table">
              {others.map((t) => {
                const free = freeSeats(t);
                const blocked = t.status === 'RESERVED' && t.seatsUsed === 0 ? 'Reserved' : free < group.guestCount ? (free > 0 ? `${free} free` : 'Full') : null;
                return (
                  <button
                    type="button"
                    key={t.id}
                    role="radio"
                    aria-checked={false}
                    className={cx('pick-tile pick-table', `occ-${t.occupancy.toLowerCase()}`)}
                    disabled={Boolean(blocked) || busy}
                    onClick={() => setTarget(t.id)}
                    aria-label={`${t.label}, ${blocked ?? `${free} of ${t.seats} seats free`}`}
                  >
                    <strong>{t.label}</strong>
                    <TableIllustration shape={t.shape} seats={t.seats} tone={t.occupancy} className="table-illus-sm" />
                    <span className="pick-table-pill">{blocked ?? `${free} of ${t.seats} free`}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {plural(group.guestCount, 'guest')} and their bill move together. Tables without enough free seats are greyed out.
      </p>
      <div className="modal-actions">
        <CancelButton onClick={onClose} disabled={busy} />
        <ConfirmButton
          busy={busy}
          disabled={!chosen}
          label={chosen ? `Move to ${chosen.label}` : 'Move'}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm(chosen!.id);
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
    </Modal>
  );
}

/** Pick the bill this group joins – at this table or another one with room for its guests. */
export function MergeGroupModal({
  group,
  table,
  tables,
  onClose,
  onConfirm,
}: {
  group: TableGroupSummaryDTO;
  table: TableDTO;
  tables: TableDTO[];
  onClose: () => void;
  onConfirm: (intoDraftId: string) => Promise<void>;
}) {
  const [into, setInto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // This table first, then the others in their usual order.
  const withGroups = [table, ...tables.filter((t) => t.id !== table.id)]
    .map((t) => ({ t, groups: t.groups.filter((g) => g.draftId !== group.draftId) }))
    .filter((x) => x.groups.length > 0);
  const chosen = withGroups.flatMap((x) => x.groups.map((g) => ({ g, t: x.t }))).find((x) => x.g.draftId === into);
  return (
    <Modal title={`Merge ${group.groupName} into another bill`} onClose={busy ? () => undefined : onClose} width={560}>
      <p className="muted" style={{ margin: 0 }}>
        {group.groupName}’s dishes are added to the bill you choose – at this table or any other – and {group.groupName}’s bill closes. Food already
        sent to the kitchen is not sent again.
      </p>
      {withGroups.length === 0 ? (
        <div className="alert alert-info">There is no other open bill to merge with.</div>
      ) : (
        <div className="stack" style={{ gap: 12, maxHeight: '50vh', overflowY: 'auto' }}>
          {withGroups.map(({ t, groups }) => {
            return (
              <div key={t.id}>
                <div className="field-label" style={{ marginBottom: 6 }}>
                  {t.id === table.id ? `This table (${t.label})` : t.label}
                </div>
                <div className="pick-grid">
                  {groups.map((g) => (
                    <button
                      type="button"
                      key={g.draftId}
                      role="radio"
                      aria-checked={into === g.draftId}
                      className={cx('pick-tile', into === g.draftId && 'active')}
                      disabled={busy}
                      onClick={() => setInto(g.draftId)}
                    >
                      <strong>{g.groupName}</strong>
                      <small>
                        {plural(g.guestCount, 'guest')} · {formatMoney(g.grandTotal)}
                      </small>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="modal-actions">
        <CancelButton onClick={onClose} disabled={busy} />
        <ConfirmButton
          busy={busy}
          disabled={!chosen}
          label={chosen ? `Merge into ${chosen.g.groupName}` : 'Merge'}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm(chosen!.g.draftId);
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
    </Modal>
  );
}

export interface SplitChoice {
  items: { menuItemId: string; quantity: number }[];
  guestCount: number;
  groupName: string;
}

/** Choose the dishes (and guests) that become a new group at the same table. */
export function SplitGroupModal({
  group,
  branchId,
  nextName,
  onClose,
  onConfirm,
}: {
  group: TableGroupSummaryDTO;
  branchId: string;
  nextName: string;
  onClose: () => void;
  onConfirm: (choice: SplitChoice) => Promise<void>;
}) {
  const { state } = useDraftSync(group.draftId, branchId);
  const lines = state.local?.items ?? [];
  const [take, setTake] = useState<Record<string, number>>({});
  const [guests, setGuests] = useState(1);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const chosen = lines.filter((l) => (take[l.menuItemId] ?? 0) > 0);
  const leavesSomething = lines.some((l) => (take[l.menuItemId] ?? 0) < l.quantity);
  const worth = chosen.reduce((a, l) => a + l.unitPrice * take[l.menuItemId], 0);
  const canSplitGuests = group.guestCount > 1;

  return (
    <Modal title={`Split ${group.groupName}’s bill`} onClose={busy ? () => undefined : onClose} width={560}>
      {!canSplitGuests ? (
        <div className="alert alert-warning">
          {group.groupName} has only 1 guest. Edit the group’s guests first, or use Merge / Move instead.
        </div>
      ) : state.status === 'loading' ? (
        <Loading label="Loading the bill…" />
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>
            Choose what goes on the new bill. It becomes a new group at this table and is paid separately.
          </p>
          <div className="split-lines">
            {lines.map((l) => (
              <div key={l.menuItemId} className="split-line">
                <div className="thumb thumb-xs">
                  <FoodImage src={l.imageUrl} alt={l.name} />
                </div>
                <span className="split-line-name">
                  {l.name}
                  <small>
                    {l.quantity} on the bill · {formatMoney(l.unitPrice)} each
                  </small>
                </span>
                <Stepper
                  label={`${l.name} to move`}
                  value={take[l.menuItemId] ?? 0}
                  min={0}
                  max={l.quantity}
                  onChange={(n) => setTake((t) => ({ ...t, [l.menuItemId]: n }))}
                />
              </div>
            ))}
          </div>
          <div className="form-grid">
            <div className="field">
              <span className="field-label">Guests moving</span>
              <Stepper label="guests moving" value={guests} min={1} max={group.guestCount - 1} onChange={setGuests} />
            </div>
            <Field label="New group name" hint={`Optional – left empty it is called “${nextName}”`}>
              {(id) => <input id={id} className="input" value={name} maxLength={40} placeholder={nextName} onChange={(e) => setName(e.target.value)} />}
            </Field>
          </div>
          {chosen.length > 0 && !leavesSomething && (
            <div className="alert alert-warning">Leave at least one dish on {group.groupName}’s bill – to send everything, use Move.</div>
          )}
        </>
      )}
      <div className="modal-actions">
        <CancelButton onClick={onClose} disabled={busy} />
        <ConfirmButton
          busy={busy}
          disabled={!canSplitGuests || chosen.length === 0 || !leavesSomething}
          label={chosen.length ? `Split off ${formatMoney(worth)}` : 'Split'}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm({
                items: chosen.map((l) => ({ menuItemId: l.menuItemId, quantity: take[l.menuItemId] })),
                guestCount: guests,
                groupName: name.trim(),
              });
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
    </Modal>
  );
}
