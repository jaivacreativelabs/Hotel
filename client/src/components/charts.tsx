/**
 * Minimal dependency-free charts. Single series in the brand hue (magnitude only), thin
 * bars with rounded data-ends, recessive grid, hover tooltip and keyboard focus.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { formatMoney } from '../utils/format';

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  sub?: string;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(600);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/** Rounds the axis maximum up to a "nice" number of paise. */
function niceMax(max: number): number {
  if (max <= 0) return 10_000;
  const rupees = max / 100;
  const pow = 10 ** Math.floor(Math.log10(rupees));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= rupees)! * pow;
  return Math.ceil(step) * 100;
}

const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });

export function BarChart({ data, height = 240, valueLabel = 'Sales' }: { data: BarDatum[]; height?: number; valueLabel?: string }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const pad = { top: 12, right: 8, bottom: 26, left: 56 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const slot = innerW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(28, slot - 2)); // ≥2px surface gap between bars
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(innerW / 64)));

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg className="chart-svg" width={width} height={height} role="img" aria-label={`${valueLabel} chart`}>
        {ticks.map((t) => {
          const y = pad.top + innerH - t * innerH;
          return (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="var(--color-border)" strokeWidth={1} />
              <text x={pad.left - 8} y={y + 4} textAnchor="end">
                ₹{compact.format((max * t) / 100)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = max ? (d.value / max) * innerH : 0;
          const x = pad.left + i * slot + (slot - barW) / 2;
          const y = pad.top + innerH - h;
          const r = Math.min(4, barW / 2, h);
          return (
            <g key={d.key}>
              {h > 0 && (
                <path
                  d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${y + h} Z`}
                  fill="var(--color-primary)"
                  opacity={hover && hover.i !== i ? 0.55 : 1}
                />
              )}
              {/* Hit target larger than the mark */}
              <rect
                x={pad.left + i * slot}
                y={pad.top}
                width={slot}
                height={innerH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${d.label}: ${formatMoney(d.value)}${d.sub ? `, ${d.sub}` : ''}`}
                onMouseMove={(e) => setHover({ i, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHover(null)}
                onFocus={(e) => {
                  const b = e.currentTarget.getBoundingClientRect();
                  setHover({ i, x: b.left + b.width / 2, y: b.top + 20 });
                }}
                onBlur={() => setHover(null)}
              />
              {i % labelEvery === 0 && (
                <text x={pad.left + i * slot + slot / 2} y={height - 8} textAnchor="middle">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover && data[hover.i] && (
        <div className="chart-tooltip" style={{ left: hover.x + 12, top: hover.y - 44 }}>
          <strong>{data[hover.i].label}</strong>
          <div>
            {valueLabel}: {formatMoney(data[hover.i].value)}
          </div>
          {data[hover.i].sub && <div>{data[hover.i].sub}</div>}
        </div>
      )}
    </div>
  );
}

export interface TrendDatum {
  key: string;
  label: string;
  /** money, paise – drawn as the line on the ₹ axis */
  value: number;
  /** order count – shown as a label above the hour (no second axis) */
  count: number;
}

/**
 * Sales trend: net total as a line on a single ₹ axis, with each point's order count shown as a
 * label above the x-axis (two measures, one scale – no dual axis).
 */
export function TrendChart({ data, height = 280 }: { data: TrendDatum[]; height?: number }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  // Bottom area holds, top to bottom: the order-count row, hour labels and the axis title.
  const pad = { top: 16, right: 18, bottom: 70, left: 60 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const step = data.length > 1 ? innerW / (data.length - 1) : 0;
  const x = (i: number) => pad.left + (data.length > 1 ? i * step : innerW / 2);
  const y = (v: number) => pad.top + innerH - (max ? (v / max) * innerH : 0);
  const baseline = pad.top + innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(innerW / 56)));
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.value)}`).join(' ');
  const area = data.length ? `${line} L${x(data.length - 1)},${baseline} L${x(0)},${baseline} Z` : '';
  const badgeY = baseline + 8; // below the plot, so a low point never hides a count
  // On narrow screens show counts only where an hour label is shown (the tooltip has all).
  const badgeEvery = step >= 30 ? 1 : labelEvery;
  const h = hover !== null ? data[hover] : null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div className="trend-legend" aria-hidden="true">
        <span>
          <i className="swatch-line" /> Net Total (₹)
        </span>
        <span>
          <i className="swatch-badge" /> Orders
        </span>
      </div>
      <svg
        className="chart-svg"
        width={width}
        height={height}
        role="img"
        aria-label="Sales trend by hour: net total and number of orders"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const bx = e.currentTarget.getBoundingClientRect().left;
          const i = Math.round((e.clientX - bx - pad.left) / (step || 1));
          setHover(Math.max(0, Math.min(data.length - 1, i)));
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(max * t)} y2={y(max * t)} stroke="var(--color-border)" />
            <text x={pad.left - 8} y={y(max * t) + 4} textAnchor="end">
              ₹{compact.format((max * t) / 100)}
            </text>
          </g>
        ))}
        <text x={14} y={pad.top + innerH / 2} transform={`rotate(-90 14 ${pad.top + innerH / 2})`} textAnchor="middle">
          Net Total (₹)
        </text>
        {data.map((d, i) => (
          <line key={d.key} x1={x(i)} x2={x(i)} y1={pad.top} y2={baseline} stroke="var(--color-border)" strokeDasharray="2 4" opacity={0.6} />
        ))}
        <path d={area} fill="var(--color-primary)" opacity={0.1} />
        <path d={line} fill="none" stroke="var(--color-primary)" strokeWidth={2.5} strokeLinejoin="round" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={baseline} stroke="var(--color-text-muted)" strokeWidth={1} />}
        {data.map((d, i) => {
          const w = Math.max(22, String(d.count).length * 7 + 10);
          return (
            <g key={d.key}>
              <circle cx={x(i)} cy={y(d.value)} r={hover === i ? 6 : 4.5} fill="var(--color-surface)" stroke="var(--color-primary)" strokeWidth={2.5} />
              {(i % badgeEvery === 0 || hover === i) && (
                <>
                  <rect x={x(i) - w / 2} y={badgeY} width={w} height={18} rx={5} fill="var(--color-accent-purple)" />
                  <text x={x(i)} y={badgeY + 13} textAnchor="middle" style={{ fill: '#fff', fontWeight: 700, fontSize: 10.5 }}>
                    {d.count}
                  </text>
                </>
              )}
              {i % labelEvery === 0 && (
                <text x={x(i)} y={height - 22} textAnchor="middle">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
        <text x={pad.left + innerW / 2} y={height - 4} textAnchor="middle">
          Hour of day
        </text>
      </svg>
      {h && (
        <div className="chart-tooltip" style={{ position: 'absolute', left: Math.min(x(hover!) + 12, width - 170), top: 40 }}>
          <strong>{h.label}</strong>
          <div>Net Total: {formatMoney(h.value)}</div>
          <div>Orders: {h.count.toLocaleString('en-IN')}</div>
        </div>
      )}
    </div>
  );
}

export function HBarList({ rows, total }: { rows: { key: string; label: string; value: number; sub?: string }[]; total?: number }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="muted">No sales in this period.</p>;
  return (
    <div className="hbar-list">
      {rows.map((r) => (
        <div key={r.key} className="hbar-row" title={r.sub}>
          <span className="label">{r.label}</span>
          <div className="hbar-track">
            <div className="hbar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <span className="value">
            {formatMoney(r.value)}
            {total ? <span className="cell-sub">{((r.value / total) * 100).toFixed(1)}%</span> : r.sub && <span className="cell-sub">{r.sub}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
