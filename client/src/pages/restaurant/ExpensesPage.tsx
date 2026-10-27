/**
 * Expenses: what a branch spends (groceries, gas, salary …). Restaurant Admins add them for their
 * branch and can fix or delete one for a short while; the Super Admin sees every branch.
 */
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
  EXPENSE_EDIT_WINDOW_MINUTES,
  MAX_EXPENSE_PAISE,
  paiseToRupeesInput,
  parseRupeesToPaise,
  type ExpenseCategory,
  type ExpenseDTO,
  type ExpenseListDTO,
  type PaymentMethod,
} from '@rb/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Calendar,
  Carrot,
  Check,
  Ellipsis,
  Flame,
  House,
  Milk,
  Pencil,
  Plus,
  ShoppingBasket,
  Trash2,
  Users,
  Wallet,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { PaymentBadge } from '../../components/badges';
import { PaymentButtons } from '../../components/PaymentButtons';
import { CancelButton, ConfirmButton, ConfirmDialog, Empty, Field, Loading, Modal, PageHeader, Pagination } from '../../components/ui';
import { useDebounce } from '../../hooks/useDebounce';
import { api } from '../../services/api';
import { useAuth } from '../../store/auth';
import { useToast } from '../../store/toast';
import { usePageSearch, useTopbarExtra } from '../../store/topbar';
import { cx, formatDay, formatMoney, isoDay, presetRange, type DatePreset } from '../../utils/format';
import { DateRangePicker } from './TransactionsPage';

export const EXPENSE_ICON: Record<ExpenseCategory, LucideIcon> = {
  GROCERIES: ShoppingBasket,
  VEGETABLES: Carrot,
  MILK: Milk,
  GAS: Flame,
  SALARY: Users,
  RENT: House,
  ELECTRICITY: Zap,
  MAINTENANCE: Wrench,
  OTHER: Ellipsis,
};

const PRESETS: [DatePreset, string][] = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['week', 'This Week'],
  ['month', 'This Month'],
  ['all', 'All'],
];

function CategoryLabel({ category }: { category: ExpenseCategory }) {
  const Icon = EXPENSE_ICON[category];
  return (
    <span className="expense-cat">
      <Icon /> {EXPENSE_CATEGORY_LABEL[category]}
    </span>
  );
}

/** Add a new expense (`expense` empty) or correct an existing one. */
function ExpenseForm({
  expense,
  branchId,
  onClose,
  onSaved,
}: {
  expense: ExpenseDTO | null;
  branchId: string | null;
  onClose: () => void;
  onSaved: (e: ExpenseDTO) => void;
}) {
  const toast = useToast();
  const today = isoDay(new Date());
  const [amount, setAmount] = useState(expense ? paiseToRupeesInput(expense.amount) : '');
  const [category, setCategory] = useState<ExpenseCategory | null>(expense?.category ?? null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(expense?.paymentMethod ?? 'CASH');
  const [date, setDate] = useState(expense?.date ?? today);
  const [note, setNote] = useState(expense?.note ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const paise = parseRupeesToPaise(amount);
    const next: Record<string, string> = {};
    if (!paise) next.amount = 'Enter an amount like 450 or 120.50';
    else if (paise > MAX_EXPENSE_PAISE) next.amount = 'Amount is too high';
    if (!category) next.category = 'Choose what the money was spent on';
    if (!date || date > today) next.date = 'Choose today or an earlier day';
    if (category === 'OTHER' && !note.trim()) next.note = 'Type what the money was spent on';
    setErrors(next);
    if (Object.keys(next).length || !paymentMethod) return;
    const body = { date, category, amount: paise, paymentMethod, note: note.trim() };
    setBusy(true);
    try {
      onSaved(
        expense
          ? await api.put<ExpenseDTO>(`/expenses/${expense.id}`, body, { branchId: null })
          : await api.post<ExpenseDTO>('/expenses', body, { branchId }),
      );
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={expense ? 'Edit expense' : 'Add expense'} onClose={busy ? () => undefined : onClose} width={560}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Amount" error={errors.amount}>
          {(id) => (
            <div className="input-prefix">
              <span>₹</span>
              <input id={id} className="input input-xl" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </div>
          )}
        </Field>
        <div className="field">
          <span className="field-label">Spent on</span>
          <div className="cat-picker" role="radiogroup" aria-label="Spent on">
            {EXPENSE_CATEGORIES.map((c) => {
              const Icon = EXPENSE_ICON[c];
              return (
                <button type="button" key={c} role="radio" aria-checked={category === c} className={cx('cat-tile', category === c && 'active')} onClick={() => setCategory(c)}>
                  {category === c && <Check className="cat-tile-check" />}
                  <span className="cat-tile-icon">
                    <Icon />
                  </span>
                  <span className="cat-tile-name">{EXPENSE_CATEGORY_LABEL[c]}</span>
                </button>
              );
            })}
          </div>
          {errors.category && <span className="field-error">{errors.category}</span>}
        </div>
        {category === 'OTHER' && (
          <Field label="What was it for?" error={errors.note}>
            {(id) => (
              <input
                id={id}
                className="input"
                value={note}
                maxLength={200}
                placeholder="e.g. Cleaning supplies, auto fare, plumber"
                onChange={(e) => setNote(e.target.value)}
                autoFocus
              />
            )}
          </Field>
        )}
        <div className="field">
          <span className="field-label">Paid by</span>
          <PaymentButtons value={paymentMethod} onChange={setPaymentMethod} disabled={busy} />
        </div>
        <div className="form-grid">
          <Field label="Date" error={errors.date}>
            {(id) => <input id={id} type="date" className="input" value={date} max={today} onChange={(e) => setDate(e.target.value)} />}
          </Field>
          {/* For "Other" the note is the "What was it for?" box above. */}
          {category !== 'OTHER' && (
            <Field label="Note" hint="Optional – e.g. shop name or who was paid">
              {(id) => <input id={id} className="input" value={note} maxLength={200} placeholder="e.g. Murugan Stores" onChange={(e) => setNote(e.target.value)} />}
            </Field>
          )}
        </div>
        <div className="modal-actions">
          <CancelButton onClick={onClose} disabled={busy} />
          <ConfirmButton type="submit" busy={busy} label={expense ? 'Save changes' : 'Add expense'} />
        </div>
      </form>
    </Modal>
  );
}

/**
 * Expense list with totals. `addBranchId` is the branch new expenses go to (none: adding is off,
 * e.g. the Super Admin has not picked a branch). `scopeFilters` adds the Super Admin's selectors.
 */
export function ExpensesView({
  scope,
  addBranchId,
  scopeFilters,
  showBranch = false,
}: {
  scope: { restaurantId?: string; branchId?: string };
  addBranchId: string | null;
  scopeFilters?: ReactNode;
  showBranch?: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const anyTime = user?.role === 'SUPER_ADMIN';
  const search = usePageSearch('Search expense notes...');
  const q = useDebounce(search.trim(), 300);
  const [preset, setPreset] = useState<DatePreset>('today');
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [category, setCategory] = useState<ExpenseCategory | ''>('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<{ expense: ExpenseDTO | null } | null>(null);
  const [deleting, setDeleting] = useState<ExpenseDTO | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const range = preset === 'custom' && custom ? custom : presetRange(preset);
  const query = useMemo(() => ({ ...scope, q, from: range.from, to: range.to, category, page, limit: 20 }), [scope, q, range.from, range.to, category, page]);
  const { restaurantId, branchId } = scope;
  useEffect(() => setPage(1), [q, range.from, range.to, category, restaurantId, branchId]);

  const list = useQuery({
    queryKey: ['expenses', query],
    queryFn: () => api.get<ExpenseListDTO>('/expenses', { query, branchId: null }),
    placeholderData: keepPreviousData,
  });
  const data = list.data;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['expenses'] });

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

  // Editing is open any time; a branch may delete an entry only in its first minutes.
  const canDelete = (e: ExpenseDTO) => anyTime || (e.editableUntil !== null && new Date(e.editableUntil).getTime() > Date.now());

  const remove = async (e: ExpenseDTO) => {
    setDeleteBusy(true);
    try {
      await api.delete(`/expenses/${e.id}`, { branchId: null });
      toast.success(`${EXPENSE_CATEGORY_LABEL[e.category]} expense of ${formatMoney(e.amount)} deleted`);
      setDeleting(null);
      void refresh();
    } catch (err) {
      toast.error(err);
    } finally {
      setDeleteBusy(false);
    }
  };

  const actions = (e: ExpenseDTO) => (
    <span className="row" style={{ gap: 4, justifyContent: 'center' }}>
      <button className="icon-btn plain" onClick={() => setForm({ expense: e })} aria-label="Edit expense" title="Edit">
        <Pencil />
      </button>
      {canDelete(e) && (
        <button className="icon-btn plain danger-text" onClick={() => setDeleting(e)} aria-label="Delete expense" title="Delete">
          <Trash2 />
        </button>
      )}
    </span>
  );

  const top = data?.byCategory[0];
  const TopIcon = top ? EXPENSE_ICON[top.category] : Wallet;

  return (
    <div className="page">
      <PageHeader
        title="Expenses"
        subtitle={anyTime ? 'Money spent by each branch' : `Record what the branch spends. You can edit an entry any time, and delete it within ${EXPENSE_EDIT_WINDOW_MINUTES} minutes.`}
        actions={
          <button
            className="btn btn-primary btn-lg"
            onClick={() => setForm({ expense: null })}
            disabled={!addBranchId}
            title={addBranchId ? undefined : 'Choose a restaurant and branch first'}
          >
            <Plus /> Add Expense
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
        <select className="select select-sm" style={{ width: 180 }} value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory | '')} aria-label="Category">
          <option value="">All categories</option>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {EXPENSE_CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
      </div>

      {data && (
        <div className="stat-grid">
          <div className="card stat">
            <div className="stat-label">
              <Wallet /> Total spent
            </div>
            <div className="stat-value danger-text">{formatMoney(data.totalAmount)}</div>
            <div className="stat-foot">
              {data.meta.total} entr{data.meta.total === 1 ? 'y' : 'ies'}
            </div>
          </div>
          <div className="card stat">
            <div className="stat-label">
              <TopIcon /> Biggest expense
            </div>
            <div className="stat-value">{top ? EXPENSE_CATEGORY_LABEL[top.category] : '–'}</div>
            <div className="stat-foot">{top ? `${formatMoney(top.amount)} · ${top.count} entr${top.count === 1 ? 'y' : 'ies'}` : 'Nothing spent yet'}</div>
          </div>
        </div>
      )}

      <div className="card">
        {list.isLoading ? (
          <Loading label="Loading expenses…" />
        ) : list.isError ? (
          <Empty title="Could not load expenses">{(list.error as Error).message}</Empty>
        ) : data!.expenses.length === 0 ? (
          <Empty icon={<Wallet />} title="No expenses found">
            {addBranchId ? 'Tap “Add Expense” to record money spent.' : 'Try another date range or branch.'}
          </Empty>
        ) : (
          <>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    {showBranch && <th>Branch</th>}
                    <th>Spent on</th>
                    <th>Note</th>
                    <th>Paid by</th>
                    <th>Amount</th>
                    <th>Added by</th>
                    <th className="center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.expenses.map((e) => (
                    <tr key={e.id}>
                      <td className="nowrap">{formatDay(e.date)}</td>
                      {showBranch && <td>{e.branchName}</td>}
                      <td>
                        <CategoryLabel category={e.category} />
                      </td>
                      <td className="muted">{e.note || '–'}</td>
                      <td>
                        <PaymentBadge method={e.paymentMethod} />
                      </td>
                      <td className="num nowrap">
                        <strong>{formatMoney(e.amount)}</strong>
                      </td>
                      <td>
                        {e.createdByName}
                        {e.editedAt && <span className="cell-sub">Edited by {e.editedByName}</span>}
                      </td>
                      <td className="center">{actions(e)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Phones: one card per expense instead of a wide table */}
            <ul className="tx-cards">
              {data!.expenses.map((e) => (
                <li key={e.id} className="tx-card">
                  <span className="tx-card-top">
                    <CategoryLabel category={e.category} />
                    <span className="tx-card-total num">{formatMoney(e.amount)}</span>
                  </span>
                  <span className="tx-card-meta">
                    {formatDay(e.date)}
                    {showBranch && ` · ${e.branchName}`}
                    {e.note && ` · ${e.note}`}
                  </span>
                  <span className="tx-card-badges">
                    <PaymentBadge method={e.paymentMethod} />
                    <span style={{ marginLeft: 'auto' }}>{actions(e)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <Pagination meta={data!.meta} onPage={setPage} />
          </>
        )}
      </div>

      {form && (
        <ExpenseForm
          expense={form.expense}
          branchId={addBranchId}
          onClose={() => setForm(null)}
          onSaved={(e) => {
            toast.success(`${EXPENSE_CATEGORY_LABEL[e.category]} expense of ${formatMoney(e.amount)} ${form.expense ? 'updated' : 'added'}`);
            setForm(null);
            void refresh();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this expense?"
          message={`${EXPENSE_CATEGORY_LABEL[deleting.category]} – ${formatMoney(deleting.amount)} on ${formatDay(deleting.date)}${deleting.note ? ` (${deleting.note})` : ''}.`}
          confirmLabel="Delete"
          danger
          busy={deleteBusy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove(deleting)}
        />
      )}
    </div>
  );
}

export function ExpensesPage() {
  const { activeBranch } = useAuth();
  const scope = useMemo(() => ({ branchId: activeBranch!.id }), [activeBranch]);
  return <ExpensesView scope={scope} addBranchId={activeBranch!.id} />;
}
