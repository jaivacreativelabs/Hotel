/**
 * Open Shop / Close Shop (Restaurant Admins). Closing emails the restaurant's report for today
 * and locks billing until the shop is opened again.
 */
import type { ShopStateDTO } from '@rb/shared';
import { DoorClosed, DoorOpen, Store } from 'lucide-react';
import { useState } from 'react';
import { api } from '../services/api';
import { useAuth } from '../store/auth';
import { useToast } from '../store/toast';
import { cx } from '../utils/format';
import { ConfirmDialog, Spinner } from './ui';

function useShop() {
  const { activeBranch, refresh } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const set = async (open: boolean) => {
    setBusy(true);
    try {
      const res = await api.post<ShopStateDTO>(open ? '/shop/open' : '/shop/close');
      if (open) toast.success('Shop is open – billing is on');
      else if (res.report) (res.report.sent ? toast.success : toast.error)(`Shop closed. ${res.report.message}`);
      else toast.success('Shop closed');
    } catch (err) {
      toast.error(err);
    } finally {
      await refresh().catch(() => undefined); // the branch's shopOpen comes with the profile
      setBusy(false);
    }
  };
  return { open: activeBranch?.shopOpen !== false, busy, set };
}

/** Bottom of the sidebar: the shop's state and the button to change it. */
export function ShopToggle() {
  const { open, busy, set } = useShop();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className={cx('shop-toggle', open ? 'open' : 'closed')}>
      <div className="shop-state">
        <span className="shop-dot" aria-hidden="true" />
        {open ? 'Shop is open' : 'Shop is closed'}
      </div>
      {open ? (
        <button className="btn btn-danger-soft btn-block" onClick={() => setConfirming(true)} disabled={busy}>
          {busy ? <Spinner /> : <DoorClosed />} Close Shop
        </button>
      ) : (
        <button className="btn btn-primary btn-block" onClick={() => void set(true)} disabled={busy}>
          {busy ? <Spinner /> : <DoorOpen />} Open Shop
        </button>
      )}
      {confirming && (
        <ConfirmDialog
          title="Close the shop for today?"
          message="Today's sales report is emailed now, and billing stops until you tap Open Shop. Generate or delete any open table bills first."
          confirmLabel="Close Shop"
          danger
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void set(false);
          }}
        />
      )}
    </div>
  );
}

/** In place of New Bill and Tables while the shop is closed. */
export function ShopClosedNotice() {
  const { busy, set } = useShop();
  return (
    <div className="page">
      <div className="card card-pad shop-closed">
        <Store size={44} />
        <h2>The shop is closed</h2>
        <p className="muted">Billing is off until the shop is opened again. Today's report was emailed when the shop closed.</p>
        <button className="btn btn-primary btn-lg" onClick={() => void set(true)} disabled={busy}>
          {busy ? <Spinner /> : <DoorOpen />} Open Shop
        </button>
      </div>
    </div>
  );
}
