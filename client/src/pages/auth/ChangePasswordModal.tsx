import { passwordSchema } from '@rb/shared';
import { useState } from 'react';
import { CancelButton, ConfirmButton, Field, Modal } from '../../components/ui';
import { api, errorMessage } from '../../services/api';
import { useToast } from '../../store/toast';

export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const check = passwordSchema.safeParse(next);
    if (!check.success) return setError(check.error.issues[0].message);
    if (next !== confirm) return setError('Passwords do not match');
    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      toast.success('Password changed. Other sessions were signed out.');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Change password" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="Current password">{(id) => <input id={id} className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />}</Field>
        <Field label="New password" hint="At least 8 characters with a letter and a number">
          {(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />}
        </Field>
        <Field label="Confirm new password" error={error}>
          {(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />}
        </Field>
        <div className="modal-actions">
          <CancelButton onClick={onClose} disabled={busy} />
          <ConfirmButton type="submit" busy={busy} label="Save" />
        </div>
      </form>
    </Modal>
  );
}
