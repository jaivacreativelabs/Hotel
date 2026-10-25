import type { AnalyticsOverviewDTO } from '@rb/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Ban, IndianRupee, Receipt, ReceiptText, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { BarChart, HBarList } from '../../components/charts';
import { Empty, Loading, PageHeader } from '../../components/ui';
import { api, errorMessage } from '../../services/api';
import { formatDay, formatMoney, PAYMENT_LABEL } from '../../utils/format';
import { useAnalyticsFilters } from './useAnalyticsFilters';

const monthFmt = new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' });

export function AnalyticsPage() {
  const { query, filters, valid } = useAnalyticsFilters('30d');
  const [showTable, setShowTable] = useState(false);
  const overview = useQuery({
    queryKey: ['admin', 'analytics', query],
    queryFn: () => api.get<AnalyticsOverviewDTO>('/admin/analytics/overview', { query, branchId: null }),
    enabled: valid,
    placeholderData: keepPreviousData,
  });
  const o = overview.data;

  return (
    <div className="page">
      <PageHeader title="Analytics" subtitle="Business-wide sales from completed bills" />
      {filters}
      {overview.isLoading || !o ? (
        overview.isError ? <Empty title="Could not load analytics">{errorMessage(overview.error)}</Empty> : <Loading />
      ) : (
        <>
          <div className="stat-grid">
            <div className="card stat">
              <div className="stat-label">
                <IndianRupee /> Total Sales
              </div>
              <div className="stat-value">{formatMoney(o.summary.totalSales)}</div>
              <div className="stat-foot">incl. {formatMoney(o.summary.taxTotal)} tax</div>
            </div>
            <div className="card stat">
              <div className="stat-label">
                <Receipt /> Completed Bills
              </div>
              <div className="stat-value">{o.summary.billCount.toLocaleString('en-IN')}</div>
              <div className="stat-foot">
                {formatDay(o.range.from)} – {formatDay(o.range.to)}
              </div>
            </div>
            <div className="card stat">
              <div className="stat-label">
                <ReceiptText /> Average Bill
              </div>
              <div className="stat-value">{formatMoney(o.summary.averageBill)}</div>
              <div className="stat-foot">per completed bill</div>
            </div>
            <div className="card stat">
              <div className="stat-label">
                <Ban /> Voided / <Undo2 /> Refunded
              </div>
              <div className="stat-value">
                {o.excluded.voidedCount} / {o.excluded.refundedCount}
              </div>
              <div className="stat-foot">{formatMoney(o.excluded.voidedAmount + o.excluded.refundedAmount)} excluded from sales</div>
            </div>
          </div>

          <div className="chart-grid">
            <div className="card chart-card wide">
              <div className="chart-head">
                <span className="card-title">Daily sales</span>
                <span className="muted">completed bills, {o.range.timezone}</span>
                <span className="spacer" />
                <button className="link-btn" onClick={() => setShowTable((s) => !s)}>
                  {showTable ? 'Hide table' : 'View as table'}
                </button>
              </div>
              {o.daily.length > 120 ? (
                <p className="muted">Range too long for a daily chart – see the monthly chart below.</p>
              ) : (
                <BarChart data={o.daily.map((d) => ({ key: d.key, label: dayFmt.format(new Date(`${d.key}T00:00:00`)), value: d.sales, sub: `${d.bills} bills` }))} />
              )}
              {showTable && (
                <div className="data-table-wrap" style={{ marginTop: 16, maxHeight: 320, overflowY: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th className="right">Bills</th>
                        <th className="right">Sales</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.daily.map((d) => (
                        <tr key={d.key}>
                          <td>{formatDay(d.key)}</td>
                          <td className="right num">{d.bills}</td>
                          <td className="right num">{formatMoney(d.sales)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="card chart-card">
              <div className="chart-head">
                <span className="card-title">Monthly sales</span>
              </div>
              <BarChart height={220} data={o.monthly.map((m) => ({ key: m.key, label: monthFmt.format(new Date(`${m.key}-01T00:00:00`)), value: m.sales, sub: `${m.bills} bills` }))} />
            </div>
            <div className="card chart-card">
              <div className="chart-head">
                <span className="card-title">Payment methods</span>
              </div>
              <HBarList
                total={o.summary.totalSales}
                rows={o.byPaymentMethod.map((p) => ({ key: p.key, label: `${PAYMENT_LABEL[p.key]} · ${p.bills} bills`, value: p.sales }))}
              />
            </div>
            <div className="card chart-card">
              <div className="chart-head">
                <span className="card-title">Restaurant-wise sales</span>
              </div>
              <HBarList rows={o.byRestaurant.map((r) => ({ key: r.key, label: r.name, value: r.sales, sub: `${r.bills} bills` }))} />
            </div>
            <div className="card chart-card">
              <div className="chart-head">
                <span className="card-title">Branch-wise sales</span>
              </div>
              <HBarList rows={o.byBranch.slice(0, 12).map((b) => ({ key: b.key, label: `${b.name} · ${b.restaurantName}`, value: b.sales, sub: `${b.bills} bills` }))} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
