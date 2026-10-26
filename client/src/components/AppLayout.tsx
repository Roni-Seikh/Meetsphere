import { History, LayoutDashboard, LogOut, Moon, Settings, Sun } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../hooks/useTheme';
import { Logo } from './ui';

const links = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/history', label: 'History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function ThemeToggle() {
  const { dark, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Light theme' : 'Dark theme'}
      className="rounded-lg p-2 text-slate-600 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}

export function AppLayout() {
  const { displayName, signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
          <NavLink to="/dashboard" aria-label="MeetSphere home">
            <Logo />
          </NavLink>
          <nav className="ml-4 hidden items-center gap-1 sm:flex" aria-label="Main">
            {links.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${
                    isActive ? 'bg-slate-200/70 dark:bg-slate-800' : 'text-slate-600 hover:bg-slate-200/50 dark:text-slate-300 dark:hover:bg-slate-800/60'
                  }`
                }
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-sm text-slate-600 dark:text-slate-300 sm:inline">{displayName}</span>
            <ThemeToggle />
            <button
              onClick={async () => {
                await signOut();
                navigate('/');
              }}
              aria-label="Sign out"
              title="Sign out"
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
        <nav className="flex gap-1 border-t border-slate-200 px-2 py-1 dark:border-slate-800 sm:hidden" aria-label="Main mobile">
          {links.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `flex-1 rounded-lg px-2 py-1.5 text-center text-sm ${isActive ? 'bg-slate-200/70 font-medium dark:bg-slate-800' : ''}`}
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
