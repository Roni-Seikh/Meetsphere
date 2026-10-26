import { Check, Hand, Mic, MicOff, UserMinus, Video, VideoOff, X } from 'lucide-react';
import type { PeerInfo, WaitingGuest } from '../../hooks/useMeetingRoom';

interface Props {
  self: PeerInfo;
  selfAudio: boolean;
  selfVideo: boolean;
  selfHand: boolean;
  peers: PeerInfo[];
  waiting: WaitingGuest[];
  onAdmit: (userId: string) => void;
  onDeny: (userId: string) => void;
  connStates: Record<string, RTCPeerConnectionState>;
  isHost: boolean;
  onRemove: (userId: string, name: string) => void;
  onEndForAll: () => void;
  onClose: () => void;
}

export function ParticipantsPanel({ self, selfAudio, selfVideo, selfHand, peers, waiting, onAdmit, onDeny, connStates, isHost, onRemove, onEndForAll, onClose }: Props) {
  const rows: { p: PeerInfo; me: boolean; audio: boolean; video: boolean }[] = [
    { p: { ...self, hand: selfHand }, me: true, audio: selfAudio, video: selfVideo },
    ...peers.map((p) => ({ p, me: false, audio: p.audio, video: p.video })),
  ];
  return (
    <aside aria-label="Participants" className="flex h-full w-full flex-col border-l border-slate-800 bg-slate-900 text-slate-100 sm:w-80">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <h2 className="font-semibold">Participants ({rows.length})</h2>
        <button onClick={onClose} aria-label="Close participants" className="rounded p-1 hover:bg-slate-800">
          <X className="h-4 w-4" />
        </button>
      </div>
      {isHost && waiting.length > 0 && (
        <section aria-label="Waiting to join" className="border-b border-slate-800 bg-slate-800/40 px-4 py-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-300">Waiting to join ({waiting.length})</h3>
          <ul className="space-y-2">
            {waiting.map((w) => (
              <li key={w.userId} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{w.name}</span>
                <button onClick={() => onAdmit(w.userId)} aria-label={`Admit ${w.name}`} className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-xs font-medium hover:bg-emerald-500">
                  <Check className="h-3.5 w-3.5" aria-hidden /> Admit
                </button>
                <button onClick={() => onDeny(w.userId)} aria-label={`Decline ${w.name}`} className="rounded bg-slate-700 px-2 py-1 text-xs font-medium hover:bg-slate-600">
                  Decline
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ul className="flex-1 divide-y divide-slate-800 overflow-y-auto">
        {rows.map(({ p, me, audio, video }) => (
          <li key={p.userId} className="flex items-center gap-3 px-4 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold">{p.name.charAt(0).toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {p.name}
                {me && ' (You)'}
              </p>
              <p className="text-xs text-slate-400">
                {p.role === 'host' ? 'Host' : 'Participant'}
                {!me && connStates[p.userId] && connStates[p.userId] !== 'connected' ? ` · ${connStates[p.userId]}` : ''}
              </p>
            </div>
            {p.hand && <Hand className="h-4 w-4 text-amber-300" aria-label="Hand raised" />}
            {audio ? <Mic className="h-4 w-4 text-slate-300" aria-label="Microphone on" /> : <MicOff className="h-4 w-4 text-red-400" aria-label="Muted" />}
            {video ? <Video className="h-4 w-4 text-slate-300" aria-label="Camera on" /> : <VideoOff className="h-4 w-4 text-red-400" aria-label="Camera off" />}
            {isHost && !me && (
              <button onClick={() => onRemove(p.userId, p.name)} aria-label={`Remove ${p.name}`} title="Remove from meeting" className="rounded p-1 text-red-400 hover:bg-slate-800">
                <UserMinus className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {isHost && (
        <div className="border-t border-slate-800 p-3">
          <button onClick={onEndForAll} className="w-full rounded-lg bg-red-600 py-2 text-sm font-medium hover:bg-red-500">
            End meeting for everyone
          </button>
        </div>
      )}
    </aside>
  );
}
