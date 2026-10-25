import type { AnalyticsOverviewDTO } from '@rb/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Building2, CalendarDays, CalendarRange, Download, FileSpreadsheet, Store } from 'lucide-react';
import { useState, type ComponentType } from 'react';
import { Loading, PageHeader, Spinner } from '../../components/ui';
import { api, downloadFile } from '../../services/api';
import { useToast } from '../../store/toast';
import { formatDay, formatMoney } from '../../utils/format';
import { useAnalyticsFilters } from './useAnalyticsFilters';

interface Report {
  id: string;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  path: string;
  extra?: Record<string, string>;
}

const REPORTS: Report[] = [
  { id: 'tx', title: 'Transaction history', description: 'Every bill with items, taxes, payment and status', icon: FileSpreadsheet, path: '/admin/reports/transactions.csv' },
  { id: 'daily', title: 'Daily sales', description: 'Completed bills and sales per day', icon: CalendarDays, path: '/admin/reports/sales.csv', extra: { granularity: 'day' } },
  { id: 'monthly', title: 'Monthly sales', description: 'Completed bills and sales per month', icon: CalendarRange, path: '/admin/reports/sales.csv', extra: { granularity: 'month' } },
  { id: 'restaurants', title: 'Restaurant-wise', description: 'Sales and average bill per restaurant', icon: Store, path: '/admin/reports/restaurants.csv' },
  { id: 'branches', title: 'Branch-wise', description: 'Sales and average bill per branch', icon: Building2, path: '/admin/reports/branches.csv' },
];

export function ReportsPage() {
  const { query, filters, valid } = useAnalyticsFilters('month');
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const overview = useQuery({
    queryKey: ['admin', 'analytics', query],
    queryFn: () => api.get<AnalyticsOverviewDTO>('/admin/analytics/overview', { query, branchId: null }),
    enabled: valid,
    placeholderData: keepPreviousData,
  });

  const download = async (r: Report) => {
    setBusy(r.id);
    try {
      await downloadFile(r.path, { ...query, ...r.extra }, `${r.id}.csv`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Reports" subtitle="Download CSV reports – the filters below apply to every download" />
      {filters}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
        {REPORTS.map((r) => (
          <div key={r.id} className="card report-card">
            <r.icon className="report-icon" />
            <div className="card-title">{r.title}</div>
            <div className="muted" style={{ flex: 1 }}>
              {r.description}
            </div>
            <button className="btn btn-outline btn-sm" onClick={() => download(r)} disabled={!valid || busy !== null}>
              {busy === r.id ? <Spinner /> : <Download size={16} />} Download CSV
            </button>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-pad row">
          <span className="card-title">Branch summary</span>
          {overview.data && (
            <span className="muted">
              {formatDay(overview.data.range.from)} – {formatDay(overview.data.range.to)}
            </span>
          )}
        </div>
        {!overview.data ? (
          <Loading />
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Restaurant</th>
                  <th>Branch</th>
                  <th className="right">Completed bills</th>
                  <th className="right">Sales</th>
                  <th className="right">Average bill</th>
                </tr>
              </thead>
              <tbody>
                {overview.data.byBranch.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted center">
                      No completed bills in this period.
                    </td>
                  </tr>
                ) : (
                  overview.data.byBranch.map((b) => (
                    <tr key={b.key}>
                      <td>{b.restaurantName}</td>
                      <td data-label="Branch">{b.name}</td>
                      <td data-label="Bills" className="right num">{b.bills}</td>
                      <td data-label="Sales" className="right num">{formatMoney(b.sales)}</td>
                      <td data-label="Average bill" className="right num">{formatMoney(b.bills ? Math.round(b.sales / b.bills) : 0)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
