import { parseRupeesToPaise } from '@rb/shared';
import { useId, useState } from 'react';
import { cx, formatMoney } from '../utils/format';

/**
 * Cash received → balance to give back, so nobody works it out by hand. Only a calculation for
 * the counter: nothing here is saved on the bill.
 */
export function ChangeCalculator({ total }: { total: number }) {
  const id = useId();
  const [received, setReceived] = useState('');
  const paise = received.trim() ? parseRupeesToPaise(received) : null;
  const balance = paise === null ? null : paise - total;
  return (
    <div className="change-calc">
      <label className="change-calc-label" htmlFor={id}>
        Received
      </label>
      <div className="input-prefix change-calc-input">
        <span>₹</span>
        <input id={id} className="input input-sm" inputMode="decimal" placeholder="0" value={received} onChange={(e) => setReceived(e.target.value)} />
      </div>
      <span className={cx('change-calc-result', balance !== null && balance < 0 && 'short')} role="status">
        {balance === null ? (
          'Balance –'
        ) : balance >= 0 ? (
          <>
            Return <strong className="num">{formatMoney(balance)}</strong>
          </>
        ) : (
          <>
            Short <strong className="num">{formatMoney(-balance)}</strong>
          </>
        )}
      </span>
    </div>
  );
}
