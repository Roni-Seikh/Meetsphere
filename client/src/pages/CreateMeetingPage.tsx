import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Button, Card, CopyButton, Field } from '../components/ui';
import { api, inviteLink, type Meeting } from '../lib/api';

export default function CreateMeetingPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [password, setPassword] = useState('');
  const [max, setMax] = useState(4);
  const [waitingRoom, setWaitingRoom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<Meeting | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const meeting = await api.createMeeting({
        title: title.trim(),
        scheduledFor: when ? new Date(when).toISOString() : null,
        password: password || null,
        maxParticipants: max,
        accessMode: waitingRoom ? 'waiting_room' : 'open',
      });
      setCreated(meeting);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the meeting');
    } finally {
      setLoading(false);
    }
  };

  if (created) {
    return (
      <Card className="mx-auto max-w-lg space-y-4">
        <Alert kind="success">Your meeting is ready.</Alert>
        <div>
          <h1 className="text-xl font-semibold">{created.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            Meeting ID: <span className="font-mono">{created.code}</span>
          </p>
        </div>
        <p className="break-all rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm dark:bg-slate-800">{inviteLink(created.code)}</p>
        {created.accessMode === 'waiting_room' && <p className="text-sm text-slate-500">Waiting room is on: you will admit guests from the participants panel.</p>}
        {created.hasPassword && <p className="text-sm text-slate-500">Share the password separately. It is not part of the link.</p>}
        <div className="flex flex-wrap gap-2">
          <CopyButton text={inviteLink(created.code)} label="Copy invite link" />
          <Button onClick={() => navigate(`/room/${created.code}`)}>Start now</Button>
          <Link to="/dashboard" className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-200/60 dark:hover:bg-slate-800">
            Dashboard
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-lg">
      <h1 className="mb-5 text-xl font-semibold">New meeting</h1>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} placeholder="Weekly sync" />
        <Field label="Schedule (optional)" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} hint="Leave empty to use it right away. The code works at any time." />
        <Field label="Password (optional)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={4} maxLength={64} autoComplete="new-password" hint="Guests must enter it to join. You, as host, never need it." />
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" checked={waitingRoom} onChange={(e) => setWaitingRoom(e.target.checked)} className="mt-1 h-4 w-4 accent-indigo-600" />
          <span>
            <span className="block text-sm font-medium">Enable waiting room</span>
            <span className="block text-xs text-slate-500">Guests wait until you admit them. You will see a prompt during the meeting.</span>
          </span>
        </label>
        <div>
          <label htmlFor="max" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Max participants: {max}
          </label>
          <input id="max" type="range" min={2} max={8} value={max} onChange={(e) => setMax(Number(e.target.value))} className="w-full accent-indigo-600" />
          <p className="mt-1 text-xs text-slate-500">Every extra person adds a video connection for everyone, so quality drops above 4-5.</p>
        </div>
        <div className="flex gap-2">
          <Button type="submit" loading={loading}>
            Create meeting
          </Button>
          <Link to="/dashboard" className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-200/60 dark:hover:bg-slate-800">
            Cancel
          </Link>
        </div>
      </form>
    </Card>
  );
}
