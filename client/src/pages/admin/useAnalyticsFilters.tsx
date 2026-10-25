import { useState } from 'react';
import { Field } from '../../components/ui';
import { cx, isoDay, presetRange, shiftDays } from '../../utils/format';
import { ScopeSelect } from './adminShared';

type RangePreset = 'today' | 'week' | 'month' | '30d' | '90d' | 'year' | 'custom';

const PRESETS: [RangePreset, string][] = [
  ['today', 'Today'],
  ['week', 'This Week'],
  ['month', 'This Month'],
  ['30d', 'Last 30 days'],
  ['90d', 'Last 90 days'],
  ['year', 'This Year'],
];

function rangeFor(p: RangePreset, custom: { from: string; to: string }) {
  const now = new Date();
  const today = isoDay(now);
  switch (p) {
    case 'today':
    case 'week':
    case 'month': {
      const r = presetRange(p, now);
      return { from: r.from!, to: r.to! };
    }
    case '30d':
      return { from: isoDay(shiftDays(now, -29)), to: today };
    case '90d':
      return { from: isoDay(shiftDays(now, -89)), to: today };
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    default:
      return custom;
  }
}

/** Shared filter row (date range, restaurant, branch) for Analytics and Reports. */
export function useAnalyticsFilters(initial: RangePreset = '30d') {
  const [preset, setPreset] = useState<RangePreset>(initial);
  const [custom, setCustom] = useState(() => rangeFor('30d', { from: '', to: '' }));
  const [scope, setScope] = useState({ restaurantId: '', branchId: '' });
  const range = rangeFor(preset, custom);
  const query = { from: range.from, to: range.to, restaurantId: scope.restaurantId || undefined, branchId: scope.branchId || undefined };

  const filters = (
    <div className="stack" style={{ gap: 12, marginBottom: 20 }}>
      <div className="filters" style={{ marginBottom: 0 }}>
        {PRESETS.map(([k, label]) => (
          <button key={k} className={cx('chip outline chip-sm', preset === k && 'active')} onClick={() => setPreset(k)}>
            {label}
          </button>
        ))}
        <button className={cx('chip outline chip-sm', preset === 'custom' && 'active')} onClick={() => setPreset('custom')}>
          Custom
        </button>
      </div>
      <div className="filters" style={{ marginBottom: 0, alignItems: 'flex-end' }}>
        {preset === 'custom' && (
          <>
            <Field label="From">{(id) => <input id={id} type="date" className="input input-sm" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />}</Field>
            <Field label="To">{(id) => <input id={id} type="date" className="input input-sm" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />}</Field>
          </>
        )}
        <ScopeSelect restaurantId={scope.restaurantId} branchId={scope.branchId} onChange={setScope} />
      </div>
    </div>
  );

  return { query, filters, valid: Boolean(range.from && range.to && range.from <= range.to) };
}
