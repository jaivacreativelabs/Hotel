import type { AdminDemoAccountDTO } from '@rb/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MonitorPlay, ShieldCheck, Store, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { ActiveBadge } from '../../components/badges';
import { Empty, Loading, PageHeader } from '../../components/ui';
import { api } from '../../services/api';
import { useToast } from '../../store/toast';

const KEY = ['admin', 'demo-accounts'] as const;

function DemoRow({ account }: { account: AdminDemoAccountDTO }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [label, setLabel] = useState(account.demoLabel);
  const [busy, setBusy] = useState(false);

  const save = async (enabled: boolean) => {
    setBusy(true);
    try {
      await api.patch(`/admin/demo-accounts/${account.id}`, { enabled, label: label.trim() }, { branchId: null });
      await queryClient.invalidateQueries({ queryKey: KEY });
      toast.success(enabled ? `“${label.trim() || account.name}” is on the login page` : `Removed ${account.name} from the login page`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr>
      <td>
        <div className="row" style={{ gap: 10 }}>
          {account.role === 'SUPER_ADMIN' ? <ShieldCheck size={20} color="var(--color-danger)" /> : <Store size={20} color="var(--color-primary)" />}
          <div>
            <strong>{account.name}</strong>
            <span className="cell-sub">{account.email}</span>
          </div>
        </div>
      </td>
      <td data-label="Access">
        <span>
          {account.role === 'SUPER_ADMIN' ? 'Super Admin' : 'Restaurant Admin'}
          <span className="cell-sub">{account.hint}</span>
        </span>
      </td>
      <td data-label="Status">
        <ActiveBadge status={account.status} />
      </td>
      <td data-label="Button label">
        <input
          className="input input-sm"
          style={{ width: 190 }}
          placeholder={account.name}
          value={label}
          maxLength={40}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => account.demoEnabled && label !== account.demoLabel && void save(true)}
          aria-label={`Button label for ${account.name}`}
        />
      </td>
      <td data-label="On login page" className="right">
        <label className="switch" title={account.demoEnabled ? 'Shown on the login page' : 'Hidden'}>
          <input type="checkbox" checked={account.demoEnabled} disabled={busy || account.status !== 'ACTIVE'} onChange={(e) => void save(e.target.checked)} />
          {account.demoEnabled ? 'Shown' : 'Hidden'}
        </label>
      </td>
    </tr>
  );
}

export function DemoLoginsPage() {
  const accounts = useQuery({ queryKey: KEY, queryFn: () => api.get<AdminDemoAccountDTO[]>('/admin/demo-accounts', { branchId: null }) });
  const shown = (accounts.data ?? []).filter((a) => a.demoEnabled);
  const superShown = shown.some((a) => a.role === 'SUPER_ADMIN');

  return (
    <div className="page">
      <PageHeader title="Demo Logins" subtitle="Choose which accounts get a one-tap sign-in button on the login page" />
      <div className={superShown ? 'alert alert-danger' : 'alert alert-warning'} style={{ marginBottom: 16 }}>
        <TriangleAlert />
        <span>
          Anyone who opens the website can use these buttons – no password needed.
          {superShown && ' A Super Admin button gives full control of every restaurant and branch.'} Switch them off when the demo is over; it
          takes effect immediately.
        </span>
      </div>
      <div className="card">
        {accounts.isLoading ? (
          <Loading />
        ) : !accounts.data?.length ? (
          <Empty icon={<MonitorPlay />} title="No accounts yet" />
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Access</th>
                  <th>Status</th>
                  <th>Button label</th>
                  <th className="right">On login page</th>
                </tr>
              </thead>
              <tbody>
                {accounts.data.map((a) => (
                  <DemoRow key={`${a.id}:${a.demoLabel}`} account={a} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
