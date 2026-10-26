import { Link } from 'react-router-dom';
import { formatWhen, statusBadge } from '../components/MeetingList';
import { Alert, EmptyState, Spinner } from '../components/ui';
import { useMeetings } from './DashboardPage';

function duration(start: string | null, end: string | null): string {
  if (!start || !end) return '-';
  const mins = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
  return mins < 1 ? '<1 min' : `${mins} min`;
}

export default function HistoryPage() {
  const { meetings, error, reload } = useMeetings();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Meeting history</h1>
      {error && (
        <Alert>
          {error}{' '}
          <button onClick={reload} className="font-medium underline">
            Retry
          </button>
        </Alert>
      )}
      {!meetings && !error && <Spinner label="Loading history" />}
      {meetings && meetings.length === 0 && (
        <EmptyState
          title="No history yet"
          description="Meetings you host or join will be listed here."
          action={
            <Link to="/meetings/new" className="text-sm font-medium text-indigo-600">
              Create a meeting
            </Link>
          }
        />
      )}
      {meetings && meetings.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">All your meetings</caption>
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800">
              <tr>
                <th scope="col" className="px-4 py-3">Title</th>
                <th scope="col" className="px-4 py-3">Created</th>
                <th scope="col" className="px-4 py-3">Duration</th>
                <th scope="col" className="px-4 py-3">Role</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {meetings.map((m) => (
                <tr key={m.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                  <td className="px-4 py-3">
                    <p className="font-medium">{m.title}</p>
                    <p className="font-mono text-xs text-slate-500">{m.code}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatWhen(m.createdAt)}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{duration(m.startedAt, m.endedAt)}</td>
                  <td className="px-4 py-3">{m.isHost ? 'Host' : 'Guest'}</td>
                  <td className="px-4 py-3">{statusBadge(m)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
