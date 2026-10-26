import { Link } from 'react-router-dom';
import { Card, Logo } from '../components/ui';
import { missingEnv } from '../lib/env';

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <Logo className="text-xl" />
      {children}
    </div>
  );
}

export function NotFoundPage() {
  return (
    <Centered>
      <p className="text-6xl font-bold text-indigo-600">404</p>
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="max-w-sm text-slate-500">The page you are looking for does not exist or was moved.</p>
      <Link to="/" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
        Go home
      </Link>
    </Centered>
  );
}

export function UnauthorizedPage() {
  return (
    <Centered>
      <p className="text-6xl font-bold text-amber-500">403</p>
      <h1 className="text-xl font-semibold">You do not have access</h1>
      <p className="max-w-sm text-slate-500">You are not allowed to view this page. Sign in with a different account or ask the host for an invite.</p>
      <div className="flex gap-2">
        <Link to="/login" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
          Sign in
        </Link>
        <Link to="/dashboard" className="rounded-lg px-4 py-2 text-sm font-medium ring-1 ring-slate-300 dark:ring-slate-700">
          Dashboard
        </Link>
      </div>
    </Centered>
  );
}

/** Shown instead of a broken app when environment variables were not provided at build time. */
export function ConfigMissingPage() {
  return (
    <Centered>
      <Card className="max-w-lg space-y-3 text-left">
        <h1 className="text-xl font-semibold">Setup needed</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          These environment variables are missing. Create <code>client/.env</code> (see <code>.env.example</code>) and restart the dev server.
        </p>
        <ul className="list-inside list-disc font-mono text-sm">
          {missingEnv.map((k) => (
            <li key={k}>{k}</li>
          ))}
        </ul>
      </Card>
    </Centered>
  );
}
