import { Lock, Play, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { inviteLink, type Meeting } from '../lib/api';
import { Badge, CopyButton } from './ui';

export function statusBadge(m: Meeting) {
  if (m.status === 'live') return <Badge tone="green">Live</Badge>;
  if (m.status === 'ended') return <Badge>Ended</Badge>;
  return <Badge tone="indigo">Scheduled</Badge>;
}

export function formatWhen(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function MeetingRow({ meeting }: { meeting: Meeting }) {
  const when = meeting.scheduledFor ?? meeting.startedAt ?? meeting.createdAt;
  const canEnter = meeting.status !== 'ended';
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium">{meeting.title}</p>
          {statusBadge(meeting)}
          {meeting.hasPassword && (
            <span title="Password protected" aria-label="Password protected">
              <Lock className="h-3.5 w-3.5 text-slate-400" />
            </span>
          )}
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
          <span>{formatWhen(when)}</span>
          <span className="font-mono">{meeting.code}</span>
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" aria-hidden /> up to {meeting.maxParticipants}
          </span>
          <span>{meeting.isHost ? 'You are the host' : `Host: ${meeting.hostName ?? 'unknown'}`}</span>
        </p>
      </div>
      {canEnter && (
        <div className="flex items-center gap-2">
          <CopyButton text={inviteLink(meeting.code)} label="Invite link" />
          <Link
            to={`/room/${meeting.code}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            <Play className="h-4 w-4" aria-hidden />
            {meeting.isHost ? 'Start' : 'Join'}
          </Link>
        </div>
      )}
    </li>
  );
}
