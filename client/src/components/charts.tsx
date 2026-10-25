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
