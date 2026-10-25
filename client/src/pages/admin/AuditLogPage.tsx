import type { AuditLogDTO } from '@rb/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useState } from 'react';
import { Empty, Loading, PageHeader, Pagination } from '../../components/ui';
import { api } from '../../services/api';
import { formatDateTime } from '../../utils/format';
import { ROLE_LABEL } from '../../utils/roles';

const ACTIONS = [
  'BILL_FINALIZED',
  'DRAFT_DELETED',
  'TRANSACTION_VOIDED',
  'TRANSACTION_REFUNDED',
  'MENU_ITEM_UPDATED',
  'MENU_ITEM_OVERRIDE_SET',
  'RESTAURANT_ADMIN_CREATED',
  'RESTAURANT_ADMIN_REASSIGNED',
  'KITCHEN_LOGIN_CREATED',
  'RESTAURANT_SETTINGS_UPDATED',
];

export function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const logs = useQuery({
    queryKey: ['admin', 'audit', page, action],
    queryFn: () => api.page<AuditLogDTO>('/admin/audit-logs', { query: { page, limit: 30, action }, branchId: null }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="page">
      <PageHeader
        title="Audit Log"
        subtitle="Who changed what – bills, deletions, menu and account changes"
        actions={
          <select
            className="select select-sm"
            style={{ width: 260 }}
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
            aria-label="Action"
          >
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </select>
        }
      />
      <div className="card">
        {logs.isLoading ? (
          <Loading />
        ) : !logs.data || logs.data.data.length === 0 ? (
          <Empty icon={<History />} title="No entries" />
        ) : (
          <>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>Action</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.data.data.map((l) => (
                    <tr key={l.id}>
                      <td className="nowrap muted">{formatDateTime(l.createdAt)}</td>
                      <td data-label="Who">
                        <span>
                          {l.actorName}
                          <span className="cell-sub">{ROLE_LABEL[l.actorRole] ?? 'System'}</span>
                        </span>
                      </td>
                      <td data-label="Action">
                        <span className="badge badge-gray badge-sm">{l.action.replace(/_/g, ' ').toLowerCase()}</span>
                      </td>
                      <td data-label="Details">{l.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination meta={logs.data.meta} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
