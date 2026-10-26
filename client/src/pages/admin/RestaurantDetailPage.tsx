import {
  bpsToPercent,
  formatBillNumber,
  LIMITS,
  parsePercentToBps,
  type BranchDTO,
  type RestaurantDTO,
  type UserDTO,
} from '@rb/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, Camera, CirclePlus, FileText, Pencil, Plus, Power, Trash2, Utensils } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ActiveBadge } from '../../components/badges';
import { ConfirmDialog, Empty, Field, Loading, PageHeader, SidePanel, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../services/api';
import { useToast } from '../../store/toast';
import { cx } from '../../utils/format';
import { shrinkImage } from '../../utils/image';
import { AdminForm, AdminsTable } from './AdminsPage';
import { adminKeys } from './adminShared';
import { RestaurantForm } from './RestaurantsPage';

interface Detail {
  restaurant: RestaurantDTO;
  branches: BranchDTO[];
  admins: UserDTO[];
}

function BranchForm({ restaurant, initial, onClose }: { restaurant: RestaurantDTO; initial?: BranchDTO; onClose: () => void }) {
  const restaurantId = restaurant.id;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    code: initial?.code ?? '',
    address: initial?.address ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
  });
  const code = form.code.trim().toUpperCase();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (initial) await api.patch(`/admin/branches/${initial.id}`, form, { branchId: null });
      else await api.post('/admin/branches', { ...form, restaurantId }, { branchId: null });
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      toast.success(initial ? 'Branch updated' : `Branch “${form.name}” created`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel title={initial ? 'Edit Branch' : 'Add Branch'} onClose={onClose}>
      <form className="stack" style={{ gap: 18 }} onSubmit={submit}>
        <Field label="Branch name">{(id) => <input id={id} className="input" value={form.name} onChange={set('name')} maxLength={100} required autoFocus />}</Field>
        <Field
          label="Branch code"
          hint={
            code
              ? `Short code, letters and digits. Bills are numbered ${formatBillNumber(code, 1)}, ${formatBillNumber(code, 2)} …`
              : 'Short code, letters and digits (e.g. ITH). Bills are numbered with it, e.g. ITH0001.'
          }
        >
          {(id) => <input id={id} className="input" value={form.code} onChange={set('code')} maxLength={10} required style={{ textTransform: 'uppercase' }} />}
        </Field>
        <Field label="Address">{(id) => <textarea id={id} className="textarea" value={form.address} onChange={set('address')} maxLength={300} />}</Field>
        <Field label="Phone">{(id) => <input id={id} className="input" value={form.phone} onChange={set('phone')} maxLength={20} />}</Field>
        <Field label="Email">{(id) => <input id={id} className="input" type="email" value={form.email} onChange={set('email')} />}</Field>
        {error && <div className="alert alert-danger">{error}</div>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy ? <Spinner /> : <CirclePlus />} {initial ? 'Save Changes' : 'Create Branch'}
        </button>
      </form>
    </SidePanel>
  );
}

/** The restaurant's logo: shown to its branches and printed on its bills. Tap to change. */
function RestaurantLogo({ restaurant }: { restaurant: RestaurantDTO }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      toast.success(done);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const upload = (file: File | undefined) => {
    if (!file) return;
    void run(async () => {
      const form = new FormData();
      form.append('image', await shrinkImage(file));
      await api.upload(`/admin/restaurants/${restaurant.id}/logo`, form, { branchId: null });
    }, 'Logo updated – it shows for the branches and on new bills');
  };
  return (
    <span className="restaurant-logo-edit">
      <label className={cx('restaurant-logo-pick', busy && 'busy')} title="Change logo">
        <img src={restaurant.logoUrl || '/logo.jpeg'} alt={`${restaurant.name} logo`} />
        <span className="restaurant-logo-cam">{busy ? <Spinner /> : <Camera size={16} />}</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
      </label>
      {restaurant.logoUrl && (
        <button
          type="button"
          className="link-btn danger"
          disabled={busy}
          onClick={() => void run(() => api.delete(`/admin/restaurants/${restaurant.id}/logo`, { branchId: null }), 'Logo removed')}
        >
          Remove
        </button>
      )}
    </span>
  );
}

function SettingsTab({ restaurant }: { restaurant: RestaurantDTO }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [taxes, setTaxes] = useState(restaurant.settings.taxes.map((t) => ({ name: t.name, rate: bpsToPercent(t.rateBps) })));
  const [inclusive, setInclusive] = useState(restaurant.settings.pricesIncludeTax);
  const [footer, setFooter] = useState(restaurant.settings.receiptFooter);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const parsed = [];
    for (const t of taxes) {
      const bps = parsePercentToBps(t.rate);
      if (!t.name.trim()) return setError('Every tax needs a name');
      if (bps === null || bps > 10_000) return setError(`Invalid rate for ${t.name}: use a percentage like 2.5`);
      parsed.push({ name: t.name.trim(), rateBps: bps });
    }
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/admin/restaurants/${restaurant.id}/settings`, { taxes: parsed, pricesIncludeTax: inclusive, receiptFooter: footer }, { branchId: null });
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      toast.success('Settings saved. New bills use them immediately; existing bills keep their original taxes.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card card-pad stack" style={{ maxWidth: 640, gap: 18 }}>
      <div>
        <div className="section-title" style={{ marginBottom: 4 }}>
          Taxes
        </div>
        <span className="field-hint">No tax is applied unless you add one here. Rates are percentages, e.g. CGST 2.5 and SGST 2.5.</span>
      </div>
      {taxes.map((t, i) => (
        <div key={i} className="row">
          <input className="input" placeholder="Name (e.g. CGST)" value={t.name} maxLength={30} onChange={(e) => setTaxes(taxes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="Tax name" />
          <div className="input-prefix" style={{ width: 160 }}>
            <input className="input" inputMode="decimal" placeholder="Rate" value={t.rate} onChange={(e) => setTaxes(taxes.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} aria-label="Tax rate percent" style={{ paddingLeft: 16 }} />
          </div>
          <span className="muted">%</span>
          <button className="icon-btn danger" onClick={() => setTaxes(taxes.filter((_, j) => j !== i))} aria-label="Remove tax">
            <Trash2 />
          </button>
        </div>
      ))}
      {taxes.length < LIMITS.maxTaxes && (
        <button className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setTaxes([...taxes, { name: '', rate: '' }])}>
          <Plus size={16} /> Add tax
        </button>
      )}
      <label className="switch">
        <input type="checkbox" checked={inclusive} onChange={(e) => setInclusive(e.target.checked)} /> Menu prices already include tax
      </label>
      <Field label="Receipt footer">{(id) => <input id={id} className="input" value={footer} maxLength={200} onChange={(e) => setFooter(e.target.value)} />}</Field>
      {error && <div className="alert alert-danger">{error}</div>}
      <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={save} disabled={busy}>
        {busy && <Spinner />} Save settings
      </button>
    </div>
  );
}

/** Turns the branch's Kitchen Display (order tickets board) on or off. */
function KitchenSwitch({ branch }: { branch: BranchDTO }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      await api.patch(`/admin/branches/${branch.id}`, { kitchenDisplay: on }, { branchId: null });
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      toast.success(on ? `Kitchen Display on for ${branch.name}` : `Kitchen Display off for ${branch.name}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <label className="switch" title={branch.kitchenDisplay ? 'Orders go to the kitchen board' : 'No kitchen board'}>
      <input type="checkbox" checked={branch.kitchenDisplay} disabled={busy} onChange={(e) => void toggle(e.target.checked)} aria-label={`Kitchen Display for ${branch.name}`} />
      {branch.kitchenDisplay ? 'On' : 'Off'}
    </label>
  );
}

export function RestaurantDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'branches' | 'admins' | 'settings'>('branches');
  const [panel, setPanel] = useState<{ kind: 'branch'; branch?: BranchDTO } | { kind: 'admin' } | { kind: 'edit' } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'restaurant' } | { kind: 'branch'; branch: BranchDTO } | null>(null);
  const detail = useQuery({ queryKey: adminKeys.restaurant(id!), queryFn: () => api.get<Detail>(`/admin/restaurants/${id}`, { branchId: null }) });

  if (detail.isLoading) return <Loading />;
  if (detail.isError) return <Empty title="Restaurant not found">{errorMessage(detail.error)}</Empty>;
  const { restaurant, branches, admins } = detail.data!;

  const toggleStatus = async () => {
    try {
      if (confirm?.kind === 'restaurant') {
        await api.patch(`/admin/restaurants/${restaurant.id}/status`, { status: restaurant.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }, { branchId: null });
      } else if (confirm?.kind === 'branch') {
        await api.patch(`/admin/branches/${confirm.branch.id}/status`, { status: confirm.branch.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }, { branchId: null });
      }
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      toast.success('Status updated');
    } catch (err) {
      toast.error(err);
    } finally {
      setConfirm(null);
    }
  };

  return (
    <>
      <div className="page">
        <Link to="/admin/restaurants" className="link-btn" style={{ marginBottom: 12 }}>
          <ArrowLeft size={16} /> All restaurants
        </Link>
        <PageHeader
          title={
            <span className="row">
              <RestaurantLogo restaurant={restaurant} />
              {restaurant.name} <ActiveBadge status={restaurant.status} />
            </span>
          }
          subtitle={restaurant.address || 'No address yet'}
          actions={
            <>
              <button className="btn btn-outline" onClick={() => setPanel({ kind: 'edit' })}>
                <Pencil /> Edit
              </button>
              <button className="btn btn-outline" onClick={() => setConfirm({ kind: 'restaurant' })}>
                <Power /> {restaurant.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
              </button>
              <button className="btn btn-soft" onClick={() => navigate(`/admin/transactions?restaurantId=${restaurant.id}`)}>
                <FileText /> Transactions
              </button>
              <button className="btn btn-primary" onClick={() => navigate(`/admin/menu?restaurantId=${restaurant.id}`)}>
                <Utensils /> Menu Management
              </button>
            </>
          }
        />
        <div className="tabs" role="tablist">
          {(
            [
              ['branches', `Branches (${branches.length})`],
              ['admins', `Admins (${admins.length})`],
              ['settings', 'Taxes & Receipt'],
            ] as const
          ).map(([key, label]) => (
            <button key={key} role="tab" aria-selected={tab === key} className={cx('tab', tab === key && 'active')} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'branches' && (
          <div className="card">
            <div className="row card-pad" style={{ paddingBottom: 0 }}>
              <span className="card-title">Branches</span>
              <span className="spacer" />
              <button className="btn btn-primary btn-sm" onClick={() => setPanel({ kind: 'branch' })}>
                <CirclePlus size={16} /> Add Branch
              </button>
            </div>
            {branches.length === 0 ? (
              <Empty icon={<Building2 />} title="No branches yet">
                Add a branch, then create a Restaurant Admin for it.
              </Empty>
            ) : (
              <div className="data-table-wrap" style={{ marginTop: 14 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Branch</th>
                      <th>Code</th>
                      <th>Contact</th>
                      <th>Status</th>
                      <th>Kitchen Display</th>
                      <th className="right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {branches.map((b) => (
                      <tr key={b.id}>
                        <td>
                          <strong>{b.name}</strong>
                          <span className="cell-sub">{b.address}</span>
                        </td>
                        <td data-label="Code">
                          {b.code}
                          <span className="cell-sub">Bills {formatBillNumber(b.code, 1)}…</span>
                        </td>
                        <td data-label="Contact" className="muted">{[b.phone, b.email].filter(Boolean).join(' · ') || '—'}</td>
                        <td data-label="Status">
                          <ActiveBadge status={b.status} />
                        </td>
                        <td data-label="Kitchen Display">
                          <KitchenSwitch branch={b} />
                        </td>
                        <td className="right nowrap">
                          <button className="icon-btn plain" onClick={() => navigate(`/admin/menu?restaurantId=${restaurant.id}&branchId=${b.id}`)} title="Branch menu" aria-label={`Menu of ${b.name}`}>
                            <Utensils />
                          </button>
                          <button className="icon-btn plain" onClick={() => setPanel({ kind: 'branch', branch: b })} title="Edit" aria-label={`Edit ${b.name}`}>
                            <Pencil />
                          </button>
                          <button className="icon-btn plain" onClick={() => setConfirm({ kind: 'branch', branch: b })} title={b.status === 'ACTIVE' ? 'Deactivate' : 'Activate'} aria-label={`Toggle ${b.name}`}>
                            <Power />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'admins' && (
          <div className="card">
            <div className="row card-pad" style={{ paddingBottom: 14 }}>
              <span className="card-title">Restaurant Admins</span>
              <span className="spacer" />
              <button className="btn btn-primary btn-sm" onClick={() => setPanel({ kind: 'admin' })} disabled={branches.length === 0}>
                <CirclePlus size={16} /> Add Admin
              </button>
            </div>
            <AdminsTable users={admins} branches={branches} />
          </div>
        )}

        {tab === 'settings' && <SettingsTab key={restaurant.id} restaurant={restaurant} />}
      </div>

      {panel?.kind === 'branch' && <BranchForm restaurant={restaurant} initial={panel.branch} onClose={() => setPanel(null)} />}
      {panel?.kind === 'admin' && <AdminForm restrictTo={restaurant.id} onClose={() => setPanel(null)} />}
      {panel?.kind === 'edit' && (
        <RestaurantForm
          initial={restaurant}
          onClose={() => setPanel(null)}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: ['admin'] });
            setPanel(null);
          }}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={
            confirm.kind === 'restaurant'
              ? `${restaurant.status === 'ACTIVE' ? 'Deactivate' : 'Activate'} ${restaurant.name}?`
              : `${confirm.branch.status === 'ACTIVE' ? 'Deactivate' : 'Activate'} ${confirm.branch.name}?`
          }
          message={
            (confirm.kind === 'restaurant' ? restaurant.status : confirm.branch.status) === 'ACTIVE'
              ? 'Restaurant Admins lose access to it immediately. Records and transactions are kept.'
              : 'Assigned Restaurant Admins regain access.'
          }
          confirmLabel="Confirm"
          danger={(confirm.kind === 'restaurant' ? restaurant.status : confirm.branch.status) === 'ACTIVE'}
          onCancel={() => setConfirm(null)}
          onConfirm={toggleStatus}
        />
      )}
    </>
  );
}
