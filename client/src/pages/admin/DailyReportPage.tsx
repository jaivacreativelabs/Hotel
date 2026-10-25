import type { DailyReportSettingsDTO } from '@rb/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Plus, RefreshCw, Send, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import { Loading, PageHeader, Spinner } from '../../components/ui';
import { api } from '../../services/api';
import { useToast } from '../../store/toast';
import { formatDateTime } from '../../utils/format';

const KEY = ['admin', 'daily-report'] as const;
const PREVIEW_KEY = ['admin', 'daily-report', 'preview'] as const;

function timeLabel(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function SettingsCard({ settings }: { settings: DailyReportSettingsDTO }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [recipients, setRecipients] = useState(settings.recipients);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<'save' | 'send' | null>(null);
  const changed = recipients.join() !== settings.recipients.join();

  const save = async (next: { enabled: boolean; recipients: string[] }) => {
    setBusy('save');
    try {
      const saved = await api.put<DailyReportSettingsDTO>('/admin/daily-report', next, { branchId: null });
      queryClient.setQueryData(KEY, saved);
      setRecipients(saved.recipients);
      toast.success(next.enabled ? 'Daily report saved' : 'Daily report turned off');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const add = () => {
    const email = draft.trim().toLowerCase();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast.error('Enter a valid email address');
    if (!recipients.includes(email)) setRecipients([...recipients, email]);
    setDraft('');
  };

  const [onceTo, setOnceTo] = useState('');
  const sendNow = async (to?: string) => {
    setBusy('send');
    try {
      const r = await api.post<{ recipients: string[] }>('/admin/daily-report/send', to ? { to: [to] } : undefined, { branchId: null });
      toast.success(`Today's report sent to ${r.recipients.join(', ')}`);
      if (to) setOnceTo('');
      void queryClient.invalidateQueries({ queryKey: KEY });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card card-pad stack daily-report-settings">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <div className="card-title">Email every day</div>
          <div className="muted">
            At {timeLabel(settings.sendTime)} with today's sales
          </div>
        </div>
        <label className="switch">
          <input type="checkbox" checked={settings.enabled} disabled={busy !== null} onChange={(e) => void save({ enabled: e.target.checked, recipients })} />
          {settings.enabled ? 'On' : 'Off'}
        </label>
      </div>

      <div>
        <div className="section-title">Send to</div>
        <ul className="recipient-list">
          {recipients.map((r) => (
            <li key={r}>
              <Mail size={16} />
              <span>{r}</span>
              <button className="icon-btn plain danger-text" onClick={() => setRecipients(recipients.filter((x) => x !== r))} aria-label={`Remove ${r}`}>
                <X size={16} />
              </button>
            </li>
          ))}
          {recipients.length === 0 && <li className="muted">No email added yet</li>}
        </ul>
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <input
            className="input"
            type="email"
            placeholder="name@gmail.com"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            aria-label="Email address"
          />
          <button className="btn btn-soft" onClick={add} disabled={!draft.trim() || recipients.length >= 10}>
            <Plus size={16} /> Add
          </button>
        </div>
      </div>

      {changed && (
        <button className="btn btn-primary" onClick={() => void save({ enabled: settings.enabled, recipients })} disabled={busy !== null}>
          {busy === 'save' && <Spinner />} Save emails
        </button>
      )}

      <hr className="divider" />
      <div className="muted" style={{ fontSize: '0.8125rem' }}>
        {settings.lastSentAt ? `Last sent ${formatDateTime(settings.lastSentAt)}` : 'Not sent yet'}
        {settings.sender && ` · from ${settings.sender}`}
      </div>
      {settings.lastError && (
        <div className="alert alert-danger">
          <TriangleAlert />
          <span>Last attempt failed: {settings.lastError}</span>
        </div>
      )}
      <button className="btn btn-primary btn-lg" onClick={() => void sendNow()} disabled={busy !== null || changed || !settings.mailConfigured || settings.recipients.length === 0}>
        {busy === 'send' ? <Spinner /> : <Send size={18} />} Send today's report now
      </button>
      <div>
        <div className="muted" style={{ fontSize: '0.8125rem', marginBottom: 6 }}>
          Send one copy to someone else (not saved)
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input className="input" type="email" placeholder="name@gmail.com" value={onceTo} onChange={(e) => setOnceTo(e.target.value)} aria-label="Send one copy to" />
          <button
            className="btn btn-soft"
            onClick={() => void sendNow(onceTo.trim().toLowerCase())}
            disabled={busy !== null || !settings.mailConfigured || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(onceTo.trim())}
          >
            <Send size={16} /> Send
          </button>
        </div>
      </div>
    </div>
  );
}

export function DailyReportPage() {
  const settings = useQuery({ queryKey: KEY, queryFn: () => api.get<DailyReportSettingsDTO>('/admin/daily-report', { branchId: null }) });
  const preview = useQuery({
    queryKey: PREVIEW_KEY,
    queryFn: () => api.get<{ html: string }>('/admin/daily-report/preview', { branchId: null }),
  });

  return (
    <div className="page">
      <PageHeader title="Daily Report" subtitle="Today's total sale, Cash / GPay / Card split and item-wise sale, emailed every day" />
      {settings.data && !settings.data.mailConfigured && (
        <div className="alert alert-warning" style={{ marginBottom: 16 }}>
          <TriangleAlert />
          <span>
            Email is not set up on the server yet. Add <strong>SMTP_USER</strong> (the Gmail address) and <strong>SMTP_PASS</strong> (its Google App password)
            to the server settings, then restart or redeploy.
          </span>
        </div>
      )}
      <div className="daily-report-layout">
        {settings.isLoading ? <Loading /> : settings.data && <SettingsCard key={settings.data.recipients.join()} settings={settings.data} />}
        <div className="card daily-report-preview">
          <div className="row" style={{ justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
            <strong>Preview of today's email</strong>
            <button className="btn btn-soft btn-sm" onClick={() => void preview.refetch()} disabled={preview.isFetching}>
              {preview.isFetching ? <Spinner /> : <RefreshCw size={15} />} Refresh
            </button>
          </div>
          {preview.isLoading ? (
            <Loading label="Building preview…" />
          ) : (
            // Scripts stay blocked; same-origin only lets us read the height to show the whole email.
            <iframe
              title="Daily report email preview"
              srcDoc={preview.data?.html ?? ''}
              sandbox="allow-same-origin"
              onLoad={(e) => {
                const doc = e.currentTarget.contentDocument;
                if (doc) e.currentTarget.style.height = `${doc.documentElement.scrollHeight}px`;
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
