import type { RestaurantDTO } from '@rb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, CirclePlus, MapPin, Phone, Store } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ActiveBadge } from '../../components/badges';
import { Empty, Field, Loading, PageHeader, SidePanel, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../services/api';
import { useToast } from '../../store/toast';
import { usePageSearch } from '../../store/topbar';
import { adminKeys, useRestaurants } from './adminShared';

export function RestaurantForm({ initial, onClose, onSaved }: { initial?: RestaurantDTO; onClose: () => void; onSaved: (r: RestaurantDTO) => void }) {
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
      toast.success(initial ? 'Restaurant updated' : `Restaurant “${saved.name}” created`);
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
        <Field label="Restaurant name">{(id) => <input id={id} className="input" value={form.name} onChange={set('name')} maxLength={100} required autoFocus />}</Field>
        <Field label="Phone">{(id) => <input id={id} className="input" value={form.phone} onChange={set('phone')} maxLength={20} />}</Field>
        <Field label="Email">{(id) => <input id={id} className="input" type="email" value={form.email} onChange={set('email')} maxLength={200} />}</Field>
        <Field label="Address">{(id) => <textarea id={id} className="textarea" value={form.address} onChange={set('address')} maxLength={300} />}</Field>
        <Field label="GSTIN" hint="Printed on receipts when set">
          {(id) => <input id={id} className="input" value={form.gstin} onChange={set('gstin')} maxLength={20} />}
        </Field>
        {error && <div className="alert alert-danger">{error}</div>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy ? <Spinner /> : <CirclePlus />} {initial ? 'Save Changes' : 'Create Restaurant'}
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
                  <span className="group-icon" style={{ background: 'var(--color-secondary-soft)', color: 'var(--color-primary)', width: 46, height: 46 }}>
                    <Store size={24} />
                  </span>
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
      {adding && (
        <RestaurantForm
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
