import { Plus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MeetingRow } from '../components/MeetingList';
import { Alert, Button, EmptyState, Field, Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { api, extractCode, type Meeting } from '../lib/api';

export function useMeetings() {
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    setError(null);
    api
      .listMeetings()
      .then((m) => active && setMeetings(m))
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : 'Could not load meetings'));
    return () => {
      active = false;
    };
  }, [tick]);
  return { meetings, error, reload: () => setTick((t) => t + 1) };
}

export default function DashboardPage() {
  const { displayName } = useAuth();
  const navigate = useNavigate();
  const { meetings, error, reload } = useMeetings();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

  const join = (e: FormEvent) => {
    e.preventDefault();
    const parsed = extractCode(code);
    if (!parsed) return setCodeError('Enter a code like abc-defg-hij or paste an invite link.');
    navigate(`/room/${parsed}`);
  };

  const upcoming = meetings?.filter((m) => m.status !== 'ended') ?? [];
  const recent = meetings?.filter((m) => m.status === 'ended').slice(0, 5) ?? [];

  return (
    <div className="space-y-10">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Hi, {displayName} 👋</h1>
          <p className="text-slate-500">Start a meeting or join one with a code.</p>
        </div>
        <Link to="/meetings/new" className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
          <Plus className="h-4 w-4" aria-hidden /> New meeting
        </Link>
      </section>

      <form onSubmit={join} className="flex flex-wrap items-start gap-2 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <Field
          className="min-w-60 flex-1"
          label="Join with a code or link"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setCodeError(null);
          }}
          placeholder="abc-defg-hij"
          error={codeError}
        />
        <Button type="submit" variant="secondary" className="mt-6">
          Join
        </Button>
      </form>

      {error && (
        <Alert>
          {error}{' '}
          <button onClick={reload} className="font-medium underline">
            Retry
          </button>
        </Alert>
      )}
      {!meetings && !error && <Spinner label="Loading your meetings" />}

      {meetings && (
        <>
          <section aria-labelledby="upcoming">
            <h2 id="upcoming" className="mb-3 text-lg font-semibold">
              Upcoming &amp; live
            </h2>
            {upcoming.length === 0 ? (
              <EmptyState
                title="No meetings yet"
                description="Create your first meeting and share the invite link with a friend."
                action={
                  <Link to="/meetings/new" className="text-sm font-medium text-indigo-600">
                    Create a meeting
                  </Link>
                }
              />
            ) : (
              <ul className="space-y-3">{upcoming.map((m) => <MeetingRow key={m.id} meeting={m} />)}</ul>
            )}
          </section>
          <section aria-labelledby="recent">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="recent" className="text-lg font-semibold">
                Recent
              </h2>
              <Link to="/history" className="text-sm font-medium text-indigo-600">
                View all
              </Link>
            </div>
            {recent.length === 0 ? (
              <p className="text-sm text-slate-500">Meetings you finish will show up here.</p>
            ) : (
              <ul className="space-y-3">{recent.map((m) => <MeetingRow key={m.id} meeting={m} />)}</ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
