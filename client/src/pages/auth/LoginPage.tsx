import { LogIn, Mail, Lock, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Field, Spinner } from '../../components/ui';
import { errorMessage } from '../../services/api';
import { useAuth } from '../../store/auth';

export function LoginPage() {
  const { user, login, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to={user.role === 'SUPER_ADMIN' ? '/admin/restaurants' : '/billing'} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <section className="login-brand">
        <img src="/logo.jpeg" alt="Idly Tiffin House logo" />
        <h2>Tiffin House Billing</h2>
        <p>Billing, tables, menu and sales for every branch – in one place.</p>
      </section>
      <section className="login-form-wrap">
        <form className="login-form" onSubmit={submit}>
          <div>
            <h1>Sign in</h1>
            <p className="muted" style={{ marginTop: 6 }}>
              Use the account given to you by your administrator.
            </p>
          </div>
          {error && (
            <div className="alert alert-danger" role="alert">
              <TriangleAlert />
              <span>{error}</span>
            </div>
          )}
          <Field label="Email">
            {(id) => (
              <div className="input-icon">
                <Mail />
                <input id={id} className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
              </div>
            )}
          </Field>
          <Field label="Password">
            {(id) => (
              <div className="input-icon">
                <Lock />
                <input id={id} className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
            )}
          </Field>
          <button className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? <Spinner /> : <LogIn />} Sign in
          </button>
        </form>
      </section>
    </div>
  );
}
