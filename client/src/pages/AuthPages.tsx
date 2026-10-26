import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ThemeToggle } from '../components/AppLayout';
import { Alert, Button, Card, Field, Logo } from '../components/ui';
import { useAuth } from '../context/AuthContext';

function Shell({ title, children, footer }: { title: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <Link to="/" className="mb-6" aria-label="MeetSphere home">
        <Logo className="text-xl" />
      </Link>
      <Card className="w-full max-w-sm">
        <h1 className="mb-5 text-xl font-semibold">{title}</h1>
        {children}
      </Card>
      <p className="mt-4 text-sm text-slate-500">{footer}</p>
    </div>
  );
}

export function LoginPage() {
  const { signIn, session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (session) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Shell
      title="Sign in"
      footer={
        <>
          New here?{' '}
          <Link to="/register" className="font-medium text-indigo-600">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate={false}>
        {error && <Alert>{error}</Alert>}
        <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        <Button type="submit" loading={loading} className="w-full">
          Sign in
        </Button>
      </form>
    </Shell>
  );
}

export function RegisterPage() {
  const { signUp, session } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  if (session) return <Navigate to="/dashboard" replace />;

  const passwordError = password && password.length < 8 ? 'Use at least 8 characters.' : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return;
    setError(null);
    setLoading(true);
    try {
      const signedIn = await signUp(name.trim(), email.trim(), password);
      if (!signedIn) setNeedsConfirm(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Shell
      title="Create your account"
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-indigo-600">
            Sign in
          </Link>
        </>
      }
    >
      {needsConfirm ? (
        <Alert kind="success">
          Account created. Check <strong>{email}</strong> for a confirmation link, then sign in.
        </Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Display name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoComplete="name" />
          <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            error={passwordError}
            hint="At least 8 characters."
          />
          <Button type="submit" loading={loading} className="w-full">
            Create account
          </Button>
        </form>
      )}
    </Shell>
  );
}
