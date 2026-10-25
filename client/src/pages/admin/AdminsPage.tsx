import { passwordSchema, type BranchDTO, type UserDTO } from '@rb/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CirclePlus, KeyRound, Pencil, Power, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ActiveBadge } from '../../components/badges';
import { CancelButton, ConfirmButton, ConfirmDialog, Empty, Field, Loading, Modal, PageHeader, SidePanel, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../services/api';
import { useToast } from '../../store/toast';
import { usePageSearch } from '../../store/topbar';
import { formatDateTime } from '../../utils/format';
import { adminKeys, useAllBranches, useRestaurants } from './adminShared';

/**
 * Branch picker grouped by restaurant. Branches are fully isolated, so a Restaurant Admin
 * manages exactly one branch (radio buttons).
 */
function BranchAssignment({ value, onChange, restrictTo }: { value: string | null; onChange: (id: string) => void; restrictTo?: string }) {
  const restaurants = useRestaurants();
  const branches = useAllBranches();
  const groups = (restaurants.data ?? [])
    .filter((r) => !restrictTo || r.id === restrictTo)
    .map((r) => ({ restaurant: r, branches: (branches.data ?? []).filter((b) => b.restaurantId === r.id) }))
    .filter((g) => g.branches.length > 0);
  if (groups.length === 0) return <span className="field-hint">Create a branch first.</span>;
  return (
    <div className="stack" style={{ gap: 10 }} role="radiogroup" aria-label="Branch">
      {groups.map(({ restaurant, branches: list }) => (
        <div key={restaurant.id} className="assign-group">
          <h4>{restaurant.name}</h4>
          {list.map((b) => (
            <label key={b.id} className="check">
              <input type="radio" name="admin-branch" checked={value === b.id} onChange={() => onChange(b.id)} />
              {b.name} <span className="muted">({b.code})</span>
              {b.status === 'INACTIVE' && <span className="badge badge-gray badge-sm">inactive</span>}
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

export function AdminForm({ initial, restrictTo, onClose }: { initial?: UserDTO; restrictTo?: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [password, setPassword] = useState('');
  // Older accounts may still list several branches; editing keeps only one.
  const [branchId, setBranchId] = useState<string | null>(initial?.branchIds[0] ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!initial) {
      const check = passwordSchema.safeParse(password);
      if (!check.success) return setError(`Password: ${check.error.issues[0].message}`);
    }
    if (!branchId) return setError('Choose the branch this admin manages');
    const branchIds = [branchId];
    setBusy(true);
    setError(null);
    try {
      if (initial) await api.patch(`/admin/users/${initial.id}`, { name, branchIds }, { branchId: null });
      else await api.post('/admin/users', { name, email, password, branchIds }, { branchId: null });
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      toast.success(initial ? 'Admin updated' : `Restaurant Admin ${email} created`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      title={initial ? 'Edit Restaurant Admin' : 'Add Restaurant Admin'}
      subtitle="A Restaurant Admin runs one branch only – billing, tables, menu and transactions of that branch"
      onClose={onClose}
    >
      <form className="stack" style={{ gap: 18 }} onSubmit={submit}>
        <Field label="Full name">{(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required autoFocus />}</Field>
        <Field label="Email (login)">
          {(id) => <input id={id} className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={Boolean(initial)} required />}
        </Field>
        {!initial && (
          <Field label="Temporary password" hint="At least 8 characters with a letter and a number. Ask the admin to change it after signing in.">
            {(id) => <input id={id} className="input" type="text" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
          </Field>
        )}
        <div className="field">
          <span className="field-label">Branch</span>
          <BranchAssignment value={branchId} onChange={setBranchId} restrictTo={initial ? undefined : restrictTo} />
          {initial && initial.branchIds.length > 1 && (
            <span className="field-hint">This admin had several branches. Saving keeps only the selected one.</span>
          )}
        </div>
        {error && <div className="alert alert-danger">{error}</div>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy ? <Spinner /> : <CirclePlus />} {initial ? 'Save Changes' : 'Create Admin'}
        </button>
      </form>
    </SidePanel>
  );
}

function ResetPasswordModal({ user, onClose }: { user: UserDTO; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const check = passwordSchema.safeParse(password);
    if (!check.success) return setError(check.error.issues[0].message);
    setBusy(true);
    try {
      await api.post(`/admin/users/${user.id}/reset-password`, { password }, { branchId: null });
      toast.success(`Password reset for ${user.email}. Existing sessions were signed out.`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Reset password – ${user.name}`} onClose={onClose}>
      <Field label="New temporary password" error={error}>
        {(id) => <input id={id} className="input" value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
      <div className="modal-actions">
        <CancelButton onClick={onClose} disabled={busy} />
        <ConfirmButton onClick={submit} busy={busy} label="Reset password" />
      </div>
    </Modal>
  );
}

export function AdminsTable({ users, branches }: { users: UserDTO[]; branches: BranchDTO[] }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<UserDTO | null>(null);
  const [resetting, setResetting] = useState<UserDTO | null>(null);
  const [toggling, setToggling] = useState<UserDTO | null>(null);
  const branchName = new Map(branches.map((b) => [b.id, b]));

  const toggle = async (u: UserDTO) => {
    try {
      await api.patch(`/admin/users/${u.id}/status`, { status: u.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }, { branchId: null });
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      toast.success(u.status === 'ACTIVE' ? `${u.name} deactivated and signed out` : `${u.name} activated`);
    } catch (err) {
      toast.error(err);
    } finally {
      setToggling(null);
    }
  };

  if (users.length === 0) return <Empty icon={<Users />} title="No Restaurant Admins yet" />;
  return (
    <>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Branches</th>
              <th>Status</th>
              <th>Last sign-in</th>
              <th className="right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>{u.name}</strong>
                  <span className="cell-sub">{u.email}</span>
                </td>
                <td>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                    {u.branchIds.map((id) => (
                      <span key={id} className="badge badge-primary badge-sm">
                        {branchName.get(id)?.name ?? 'Unknown'}
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  <ActiveBadge status={u.status} />
                </td>
                <td className="muted nowrap">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</td>
                <td className="right nowrap">
                  <button className="icon-btn plain" onClick={() => setEditing(u)} title="Edit / reassign" aria-label={`Edit ${u.name}`}>
                    <Pencil />
                  </button>
                  <button className="icon-btn plain" onClick={() => setResetting(u)} title="Reset password" aria-label={`Reset password of ${u.name}`}>
                    <KeyRound />
                  </button>
                  <button className="icon-btn plain" onClick={() => setToggling(u)} title={u.status === 'ACTIVE' ? 'Deactivate' : 'Activate'} aria-label={`Toggle ${u.name}`}>
                    <Power />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <AdminForm initial={editing} onClose={() => setEditing(null)} />}
      {resetting && <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />}
      {toggling && (
        <ConfirmDialog
          title={toggling.status === 'ACTIVE' ? `Deactivate ${toggling.name}?` : `Activate ${toggling.name}?`}
          message={toggling.status === 'ACTIVE' ? 'They will be signed out immediately and cannot sign in until reactivated.' : 'They will be able to sign in again.'}
          confirmLabel={toggling.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
          danger={toggling.status === 'ACTIVE'}
          onCancel={() => setToggling(null)}
          onConfirm={() => toggle(toggling)}
        />
      )}
    </>
  );
}

export function AdminsPage() {
  const search = usePageSearch('Search admins by name or email...');
  const users = useQuery({ queryKey: adminKeys.users, queryFn: () => api.get<UserDTO[]>('/admin/users', { branchId: null }) });
  const branches = useAllBranches();
  const [adding, setAdding] = useState(false);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (users.data ?? []).filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.includes(q));
  }, [users.data, search]);

  return (
    <>
      <div className="page">
        <PageHeader
          title="Restaurant Admins"
          subtitle="Create accounts and assign them to branches"
          actions={
            <button className="btn btn-primary btn-lg" onClick={() => setAdding(true)}>
              <CirclePlus /> Add Admin
            </button>
          }
        />
        <div className="card">{users.isLoading ? <Loading /> : <AdminsTable users={visible} branches={branches.data ?? []} />}</div>
      </div>
      {adding && <AdminForm onClose={() => setAdding(false)} />}
    </>
  );
}
