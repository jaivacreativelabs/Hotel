import {
  Building2,
  ChartColumn,
  ChartLine,
  ChefHat,
  ChevronDown,
  CircleCheck,
  CirclePlus,
  CloudOff,
  FileText,
  History,
  KeyRound,
  LogOut,
  Mail,
  Menu as MenuIcon,
  MonitorPlay,
  Search,
  Store,
  UserRound,
  Users,
  Utensils,
} from 'lucide-react';
import { Suspense, useEffect, useRef, useState, useSyncExternalStore, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { TableIcon } from '../components/badges';
import { Loading } from '../components/ui';
import { ChangePasswordModal } from '../pages/auth/ChangePasswordModal';
import { useAuth } from '../store/auth';
import { getSyncSummary, subscribeSyncSummary } from '../store/draftSync';
import { useTopbar } from '../store/topbar';
import { cx } from '../utils/format';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  primary?: boolean;
  end?: boolean;
}

const RESTAURANT_NAV: NavItem[] = [
  { to: '/billing', label: 'New Bill', icon: CirclePlus, primary: true },
  { to: '/menu', label: 'Menu', icon: Utensils },
  { to: '/transactions', label: 'Transactions', icon: FileText },
  { to: '/tables', label: 'Tables', icon: TableIcon },
];
// Shown only when the Super Admin has switched the Kitchen Display on for the branch.
const KITCHEN_NAV: NavItem = { to: '/kitchen', label: 'Kitchen', icon: ChefHat };

const ADMIN_NAV: NavItem[] = [
  { to: '/admin/restaurants', label: 'Restaurants', icon: Store },
  { to: '/admin/users', label: 'Admins', icon: Users },
  { to: '/admin/menu', label: 'Menu', icon: Utensils },
  { to: '/admin/transactions', label: 'Transactions', icon: FileText },
  { to: '/admin/reports', label: 'Reports', icon: ChartLine },
  { to: '/admin/analytics', label: 'Analytics', icon: ChartColumn },
  { to: '/admin/daily-report', label: 'Daily Report', icon: Mail },
  { to: '/admin/audit', label: 'Audit Log', icon: History },
  { to: '/admin/demo-logins', label: 'Demo Logins', icon: MonitorPlay },
];

function SyncIndicator() {
  const { pending, failing } = useSyncExternalStore(subscribeSyncSummary, getSyncSummary);
  if (failing > 0) {
    return (
      <span className="sync-pill error" title="Some bill changes could not be saved yet. They are kept and retried automatically.">
        <CloudOff size={16} /> {failing}
        <span className="sync-text">
          {' '}
          bill{failing > 1 ? 's' : ''} not saved – retrying
        </span>
      </span>
    );
  }
  if (pending > 0) return <span className="sync-pill">Saving…</span>;
  return null;
}

function UserMenu() {
  const { user, branches, activeBranch, selectBranch, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  if (!user) return null;
  const roleText = user.role === 'SUPER_ADMIN' ? 'Super Admin' : activeBranch ? `${activeBranch.restaurant.name} · ${activeBranch.name}` : 'Restaurant Admin';
  return (
    <div className="user-menu" ref={ref}>
      <button className="user-button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <span className="avatar">
          <UserRound size={24} />
        </span>
        <span>
          <span className="user-name">{user.name}</span>
          <span className="user-role">
            {roleText}
          </span>
        </span>
        <ChevronDown size={20} />
      </button>
      {open && (
        <div className="menu-popover" role="menu">
          {branches.length > 1 && (
            <>
              <div className="menu-label">Branch</div>
              {branches.map((b) => (
                <button
                  key={b.id}
                  className={cx('menu-item', b.id === activeBranch?.id && 'selected')}
                  role="menuitemradio"
                  aria-checked={b.id === activeBranch?.id}
                  onClick={() => {
                    selectBranch(b.id);
                    setOpen(false);
                  }}
                >
                  <Building2 size={18} />
                  <span>
                    {b.name}
                    <small>{b.restaurant.name}</small>
                  </span>
                  {b.id === activeBranch?.id && <CircleCheck size={18} style={{ marginLeft: 'auto' }} />}
                </button>
              ))}
              <hr className="divider" />
            </>
          )}
          <button
            className="menu-item"
            role="menuitem"
            onClick={() => {
              setChangingPassword(true);
              setOpen(false);
            }}
          >
            <KeyRound size={18} /> Change password
          </button>
          <button
            className="menu-item"
            role="menuitem"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            <LogOut size={18} /> Sign out
          </button>
        </div>
      )}
      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
    </div>
  );
}

export function AppLayout() {
  const { user, activeBranch } = useAuth();
  const { placeholder, query, setQuery, extra } = useTopbar();
  const isSuper = user?.role === 'SUPER_ADMIN';
  const nav = isSuper ? ADMIN_NAV : activeBranch?.kitchenDisplay ? [...RESTAURANT_NAV, KITCHEN_NAV] : RESTAURANT_NAV;
  // Phones: Restaurant Admins get a bottom tab bar; the Super Admin a slide-in menu.
  const bottomNav = !isSuper;
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setNavOpen(false), [location.pathname]);

  return (
    <div className={cx('app', bottomNav && 'has-bottom-nav')}>
      <div className="brand">
        <img src="/logo.jpeg" alt="" />
        <div>
          <div className="brand-name">Tiffin House</div>
          <div className="brand-sub">{user?.role === 'SUPER_ADMIN' ? 'Super Admin Panel' : 'Billing & POS'}</div>
        </div>
      </div>
      <header className="topbar">
        {!bottomNav && (
          <button className="icon-btn plain nav-toggle" onClick={() => setNavOpen((o) => !o)} aria-label="Open menu" aria-expanded={navOpen}>
            <MenuIcon />
          </button>
        )}
        <img className="topbar-logo" src="/logo.jpeg" alt="Tiffin House" />
        {placeholder ? (
          <div className="search">
            <Search />
            <input type="search" value={query} placeholder={placeholder} onChange={(e) => setQuery(e.target.value)} aria-label={placeholder} />
          </div>
        ) : (
          <div className="spacer" />
        )}
        {extra && <div className="topbar-extra">{extra}</div>}
        <SyncIndicator />
        <UserMenu />
      </header>
      <nav className={cx('sidebar', navOpen && 'open')} aria-label="Main">
        {nav.map(({ to, label, icon: Icon, primary, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => cx('nav-link', primary && 'primary', isActive && 'active')}>
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
        <div className="sidebar-footer">Fresh starts. Good days.</div>
      </nav>
      {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />}
      <main className="content">
        <Suspense fallback={<Loading />}>
          <Outlet />
        </Suspense>
      </main>
      {bottomNav && (
        <nav className="bottom-nav" aria-label="Main">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => cx('bottom-nav-link', isActive && 'active')}>
              <Icon />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
