import type { TableOccupancy, TableShape } from '@rb/shared';

type Tone = TableOccupancy | 'WOOD';

const TONES: Record<Tone, { top: string; edge: string; chair: string; back: string }> = {
  WOOD: { top: 'var(--table-wood)', edge: 'var(--table-wood-dark)', chair: '#b5773c', back: 'var(--table-wood-dark)' },
  AVAILABLE: { top: 'var(--table-wood)', edge: 'var(--table-wood-dark)', chair: '#b5773c', back: 'var(--table-wood-dark)' },
  PARTIAL: { top: '#f6c62e', edge: '#c99a00', chair: '#efb800', back: '#b98b00' },
  FULL: { top: '#ef5350', edge: '#c62828', chair: '#e53935', back: '#b71c1c' },
  RESERVED: { top: '#a3a8a1', edge: '#6f756d', chair: '#8e938c', back: '#5f655d' },
};

const W = 120;
const H = 104;
const CX = W / 2;
const CY = H / 2;

/** A chair seen from above: seat plus a darker back rest facing away from the table. */
function Chair({ x, y, angle, t }: { x: number; y: number; angle: number; t: (typeof TONES)[Tone] }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <rect x={-11} y={-7} width={22} height={14} rx={4} fill={t.chair} />
      <rect x={-12} y={-11} width={24} height={6} rx={3} fill={t.back} />
    </g>
  );
}

/** Distributes chairs around the four sides of a square table. */
function squareChairs(seats: number) {
  const n = Math.min(Math.max(seats, 1), 8);
  const perSide = [0, 0, 0, 0]; // top, bottom, left, right
  const order = [0, 1, 2, 3];
  for (let i = 0; i < n; i++) perSide[order[i % 4]] += 1;
  const out: { x: number; y: number; angle: number }[] = [];
  const spread = (count: number, len: number) => Array.from({ length: count }, (_, i) => ((i + 1) * len) / (count + 1) - len / 2);
  spread(perSide[0], 56).forEach((d) => out.push({ x: CX + d, y: CY - 39, angle: 0 }));
  spread(perSide[1], 56).forEach((d) => out.push({ x: CX + d, y: CY + 39, angle: 180 }));
  spread(perSide[2], 48).forEach((d) => out.push({ x: CX - 47, y: CY + d, angle: -90 }));
  spread(perSide[3], 48).forEach((d) => out.push({ x: CX + 47, y: CY + d, angle: 90 }));
  return out;
}

function roundChairs(seats: number) {
  const n = Math.min(Math.max(seats, 1), 8);
  return Array.from({ length: n }, (_, i) => {
    const a = (i * 360) / n - 90;
    const r = 40;
    return { x: CX + r * Math.cos((a * Math.PI) / 180), y: CY + r * Math.sin((a * Math.PI) / 180), angle: a + 90 };
  });
}

export function TableIllustration({ shape, seats, tone, className = 'table-illus' }: { shape: TableShape; seats: number; tone: Tone; className?: string }) {
  const t = TONES[tone];
  const chairs = shape === 'ROUND' ? roundChairs(seats) : squareChairs(seats);
  return (
    <svg className={className} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {chairs.map((c, i) => (
        <Chair key={i} {...c} t={t} />
      ))}
      {shape === 'ROUND' ? (
        <>
          <circle cx={CX} cy={CY + 2} r={30} fill={t.edge} />
          <circle cx={CX} cy={CY} r={30} fill={t.top} />
          <circle cx={CX - 8} cy={CY - 9} r={11} fill="#fff" opacity={0.14} />
        </>
      ) : (
        <>
          <rect x={CX - 31} y={CY - 27} width={62} height={58} rx={7} fill={t.edge} />
          <rect x={CX - 31} y={CY - 29} width={62} height={56} rx={7} fill={t.top} />
          <rect x={CX - 25} y={CY - 23} width={22} height={10} rx={4} fill="#fff" opacity={0.12} />
        </>
      )}
    </svg>
  );
}
