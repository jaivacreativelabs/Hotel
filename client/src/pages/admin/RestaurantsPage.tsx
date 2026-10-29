import { formatBillNumber, type RestaurantDTO } from '@rb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, CirclePlus, MapPin, Phone, Store } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ActiveBadge } from '../../components/badges';
import { Empty, Field, Loading, PageHeader, SidePanel, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../services/api';
import { useToast } from '../../store/toast';
import { usePageSearch } from '../../store/topbar';
import { cx } from '../../utils/format';
import { adminKeys, useRestaurants } from './adminShared';

export function RestaurantForm({
  initial,
  header,
  onClose,
  onSaved,
}: {
  initial?: RestaurantDTO;
  /** shown above the fields (Add Restaurant: new restaurant or branch) */
  header?: ReactNode;
  onClose: () => void;
  onSaved: (r: RestaurantDTO) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
    address: initial?.address ?? '',
    gstin: initial?.gstin ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = initial
        ? await api.patch<RestaurantDTO>(`/admin/restaurants/${initial.id}`, form, { branchId: null })
        : await api.post<RestaurantDTO>('/admin/restaurants', form, { branchId: null });
      toast.success(initial ? 'Restaurant updated' : `Restaurant “${saved.name}” created with its Main Branch`);
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel title={initial ? 'Edit Restaurant' : 'Add Restaurant'} onClose={onClose}>
      <form className="stack" style={{ gap: 18 }} onSubmit={submit}>
        {header}
        <Field label="Restaurant name">{(id) => <input id={id} className="input" value={form.name} onChange={set('name')} maxLength={100} required autoFocus />}</Field>
        <Field label="Phone">{(id) => <input id={id} className="input" value={form.phone} onChange={set('phone')} maxLength={20} />}</Field>
        <Field label="Email">{(id) => <input id={id} className="input" type="email" value={form.email} onChange={set('email')} maxLength={200} />}</Field>
        <Field label="Address">{(id) => <textarea id={id} className="textarea" value={form.address} onChange={set('address')} maxLength={300} />}</Field>
        <Field label="GSTIN" hint="Printed on receipts when set">
          {(id) => <input id={id} className="input" value={form.gstin} onChange={set('gstin')} maxLength={20} />}
        </Field>
        {!initial && (
          <div className="alert alert-info">
            <Building2 />
            <span>
              A <strong>Main Branch</strong> is created automatically with these contact details. You can rename it or add more
              branches afterwards.
            </span>
          </div>
        )}
        {error && <div className="alert alert-danger">{error}</div>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy ? <Spinner /> : <CirclePlus />} {initial ? 'Save Changes' : 'Create Restaurant'}
        </button>
      </form>
    </SidePanel>
  );
}

/** "Keda Kari Virundhu" → "KKV": a suggested bill code for a new branch. */
const suggestCode = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, '')[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 10);

type AddAs = 'BRANCH' | 'RESTAURANT';

function AddAsChoice({ value, onChange }: { value: AddAs; onChange: (v: AddAs) => void }) {
  return (
    <div className="field">
      <span className="field-label">Add as</span>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }} role="radiogroup" aria-label="Add as">
        {(
          [
            ['BRANCH', 'Branch of a restaurant', Building2],
            ['RESTAURANT', 'New restaurant', Store],
          ] as const
        ).map(([v, label, Icon]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} className={cx('chip outline', value === v && 'active')} onClick={() => onChange(v)}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>
      <span className="field-hint">
        {value === 'BRANCH'
          ? 'Goes under an existing restaurant as one more branch – shares its menu, logo and settings, with its own bills and admin.'
          : 'A separate restaurant with its own menu, logo and settings (its Main Branch is created with it).'}
      </span>
    </div>
  );
}

/** Add Restaurant in branch mode: the new place becomes a branch of a restaurant already here. */
function NewBranchForm({
  header,
  restaurants,
  onClose,
  onSaved,
}: {
  header: ReactNode;
  restaurants: RestaurantDTO[];
  onClose: () => void;
  onSaved: (restaurantId: string) => void;
}) {
  const toast = useToast();
  const [restaurantId, setRestaurantId] = useState(restaurants[0]?.id ?? '');
  const [form, setForm] = useState({ name: '', code: '', address: '', phone: '', email: '' });
  const [codeTouched, setCodeTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const code = (codeTouched ? form.code : suggestCode(form.name)).trim().toUpperCase();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const parent = restaurants.find((r) => r.id === restaurantId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restaurantId) return setError('Choose the restaurant this branch belongs to');
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/branches', { ...form, code, restaurantId }, { branchId: null });
      toast.success(`“${form.name}” added as a branch of ${parent?.name ?? 'the restaurant'}`);
      onSaved(restaurantId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel title="Add Restaurant" onClose={onClose}>
      <form className="stack" style={{ gap: 18 }} onSubmit={submit}>
        {header}
        <Field label="Branch of">
          {(id) => (
            <select id={id} className="select" value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)} required>
              {restaurants.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Name">
          {(id) => <input id={id} className="input" value={form.name} onChange={set('name')} maxLength={100} required autoFocus placeholder="e.g. Keda Kari Virundhu" />}
        </Field>
        <Field label="Bill code" hint={code ? `Its bills are numbered ${formatBillNumber(code, 1)}, ${formatBillNumber(code, 2)} …` : 'Short code, letters and digits (e.g. KKV)'}>
          {(id) => (
            <input
              id={id}
              className="input"
              value={code}
              onChange={(e) => {
                setCodeTouched(true);
                setForm({ ...form, code: e.target.value });
              }}
              maxLength={10}
              required
              style={{ textTransform: 'uppercase' }}
            />
          )}
        </Field>
        <Field label="Address">{(id) => <textarea id={id} className="textarea" value={form.address} onChange={set('address')} maxLength={300} />}</Field>
        <Field label="Phone">{(id) => <input id={id} className="input" value={form.phone} onChange={set('phone')} maxLength={20} />}</Field>
        <Field label="Email">{(id) => <input id={id} className="input" type="email" value={form.email} onChange={set('email')} maxLength={200} />}</Field>
        {error && <div className="alert alert-danger">{error}</div>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy ? <Spinner /> : <CirclePlus />} Create Branch
        </button>
      </form>
    </SidePanel>
  );
}

export function RestaurantsPage() {
  const restaurants = useRestaurants();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = usePageSearch('Search restaurants...');
  const [adding, setAdding] = useState(false);
  // New places go in as branches of a restaurant by default; a separate restaurant is one tap away.
  const [addAs, setAddAs] = useState<AddAs>('BRANCH');
  const hasRestaurants = (restaurants.data ?? []).length > 0;
  const visible = useMemo(
    () => (restaurants.data ?? []).filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase())),
    [restaurants.data, search],
  );

  return (
    <>
      <div className="page">
        <PageHeader
          title="Restaurants"
          subtitle="Create restaurants, branches and Restaurant Admin accounts"
          actions={
            <button className="btn btn-primary btn-lg" onClick={() => setAdding(true)}>
              <CirclePlus /> Add Restaurant
            </button>
          }
        />
        {restaurants.isLoading ? (
          <Loading />
        ) : visible.length === 0 ? (
          <Empty icon={<Store />} title={search ? 'No restaurants match' : 'No restaurants yet'}>
            {!search && 'Create your first restaurant to get started.'}
          </Empty>
        ) : (
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {visible.map((r) => (
              <div
                key={r.id}
                className="card restaurant-card"
                role="link"
                tabIndex={0}
                onClick={() => navigate(`/admin/restaurants/${r.id}`)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/admin/restaurants/${r.id}`)}
              >
                <div className="row">
                  {r.logoUrl ? (
                    <img className="restaurant-logo" src={r.logoUrl} alt="" />
                  ) : (
                    <span className="group-icon" style={{ background: 'var(--color-secondary-soft)', color: 'var(--color-primary)', width: 46, height: 46 }}>
                      <Store size={24} />
                    </span>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div className="card-title">{r.name}</div>
                    <ActiveBadge status={r.status} />
                  </div>
                </div>
                <div className="row muted" style={{ fontSize: 'var(--font-size-sm)' }}>
                  <Building2 size={16} /> {r.branchCount ?? 0} branch{r.branchCount === 1 ? '' : 'es'}
                  {r.phone && (
                    <>
                      <Phone size={16} style={{ marginLeft: 10 }} /> {r.phone}
                    </>
                  )}
                </div>
                {r.address && (
                  <div className="row muted" style={{ fontSize: 'var(--font-size-sm)' }}>
                    <MapPin size={16} /> {r.address}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {adding && addAs === 'BRANCH' && hasRestaurants && (
        <NewBranchForm
          header={<AddAsChoice value={addAs} onChange={setAddAs} />}
          restaurants={restaurants.data ?? []}
          onClose={() => setAdding(false)}
          onSaved={(restaurantId) => {
            void queryClient.invalidateQueries({ queryKey: ['admin'] });
            setAdding(false);
            navigate(`/admin/restaurants/${restaurantId}`);
          }}
        />
      )}
      {adding && (addAs === 'RESTAURANT' || !hasRestaurants) && (
        <RestaurantForm
          header={hasRestaurants ? <AddAsChoice value={addAs} onChange={setAddAs} /> : undefined}
          onClose={() => setAdding(false)}
          onSaved={(r) => {
            void queryClient.invalidateQueries({ queryKey: adminKeys.restaurants });
            setAdding(false);
            navigate(`/admin/restaurants/${r.id}`);
          }}
        />
      )}
    </>
  );
}
