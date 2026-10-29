import { parsePercentToBps, parseRupeesToPaise, type DiscountInput } from '@rb/shared';
import { Tag } from 'lucide-react';
import { useState } from 'react';

/** "Add discount" link that opens % / ₹ entry. Used on New Bill and a table group's bill. */
export function DiscountEditor({ value, onApply }: { value: DiscountInput | null; onApply: (d: DiscountInput | null) => void }) {
  const [open, setOpen] = useState(Boolean(value));
  const [type, setType] = useState<DiscountInput['type']>(value?.type ?? 'PERCENT');
  const [text, setText] = useState(value ? String(value.type === 'PERCENT' ? value.value / 100 : value.value / 100) : '');
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button className="link-btn" onClick={() => setOpen(true)}>
        <Tag size={15} /> Add discount
      </button>
    );
  }
  const apply = () => {
    if (!text.trim()) {
      onApply(null);
      setError(null);
      return;
    }
    const parsed = type === 'PERCENT' ? parsePercentToBps(text) : parseRupeesToPaise(text);
    if (parsed === null || (type === 'PERCENT' && parsed > 10_000)) {
      setError(type === 'PERCENT' ? 'Enter 0–100 %' : 'Enter an amount like 50 or 49.50');
      return;
    }
    setError(null);
    onApply({ type, value: parsed });
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="discount-row">
        <select className="select select-sm" value={type} onChange={(e) => setType(e.target.value as DiscountInput['type'])} aria-label="Discount type">
          <option value="PERCENT">%</option>
          <option value="FLAT">₹</option>
        </select>
        <input
          className="input input-sm"
          inputMode="decimal"
          placeholder={type === 'PERCENT' ? 'e.g. 10' : 'e.g. 50'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && apply()}
          aria-label="Discount value"
        />
        <button className="btn btn-soft btn-sm" onClick={apply}>
          Apply
        </button>
      </div>
      <div className="row">
        {error && <span className="field-error">{error}</span>}
        <span className="spacer" />
        <button
          className="link-btn danger"
          onClick={() => {
            setText('');
            onApply(null);
            setOpen(false);
          }}
        >
          Remove discount
        </button>
      </div>
    </div>
  );
}
