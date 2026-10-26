import { Clock, DoorOpen, Lock, Users, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMeetingRoom } from '../../hooks/useMeetingRoom';
import type { useLocalMedia } from '../../hooks/useLocalMedia';
import { inviteLink } from '../../lib/api';
import { Alert, Button, CopyButton, Spinner } from '../ui';
import { ChatPanel } from './ChatPanel';
import { ControlBar } from './ControlBar';
import { ParticipantsPanel } from './ParticipantsPanel';
import { ReactionOverlay } from './ReactionOverlay';
import { VideoTile } from './VideoTile';

type Media = ReturnType<typeof useLocalMedia>;

function useElapsed(since: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const END_MESSAGES = {
  ended: { title: 'The meeting has ended', text: 'The host ended this meeting for everyone.' },
  removed: { title: 'You were removed', text: 'The host removed you from this meeting.' },
  replaced: { title: 'Joined from another tab', text: 'You opened this meeting somewhere else, so this window was disconnected.' },
  denied: { title: 'Request declined', text: 'The host did not admit you to this meeting.' },
} as const;

export function InCall({ code, password, media, onBackToLobby }: { code: string; password?: string; media: Media; onBackToLobby: () => void }) {
  const navigate = useNavigate();
  const room = useMeetingRoom({
    code,
    password,
    stream: media.stream,
    audioEnabled: media.audioEnabled,
    videoEnabled: media.videoEnabled,
  });
  const [chatOpen, setChatOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [joinedAt] = useState(() => Date.now());
  const seenRef = useRef(0);
  const elapsed = useElapsed(room.meeting?.startedAt ? new Date(room.meeting.startedAt).getTime() : joinedAt);
  const canShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

  // Unread chat badge
  useEffect(() => {
    const n = room.messages.length;
    if (chatOpen) {
      seenRef.current = n;
      setUnread(0);
    } else {
      setUnread(Math.max(0, n - seenRef.current));
    }
  }, [room.messages, chatOpen]);

  const leave = useCallback(() => {
    media.stop();
    navigate('/dashboard');
  }, [media, navigate]);

  const toggleShare = useCallback(() => {
    if (room.sharing) room.stopSharing();
    else void room.startSharing();
  }, [room]);

  const toggleChat = useCallback(() => {
    setChatOpen((o) => !o);
    setPeopleOpen(false);
  }, []);
  const togglePeople = useCallback(() => {
    setPeopleOpen((o) => !o);
    setChatOpen(false);
  }, []);

  // Keyboard shortcuts (ignored while typing in an input)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      switch (e.key.toLowerCase()) {
        case 'm':
          media.toggleAudio();
          break;
        case 'v':
          media.toggleVideo();
          break;
        case 's':
          toggleShare();
          break;
        case 'c':
          toggleChat();
          break;
        case 'p':
          togglePeople();
          break;
        case 'h':
          room.toggleHand();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [media, room, toggleShare, toggleChat, togglePeople]);

  const peerList = useMemo(() => Object.values(room.peers), [room.peers]);
  const isHost = room.self?.role === 'host';

  if (room.status === 'ended' || room.status === 'removed' || room.status === 'replaced' || room.status === 'denied') {
    const m = END_MESSAGES[room.status];
    return (
      <FullMessage title={m.title} text={m.text}>
        <Button onClick={leave}>Back to dashboard</Button>
      </FullMessage>
    );
  }
  if (room.status === 'waiting') {
    return (
      <FullMessage title="Waiting for the host" text={`The host of “${room.waitingTitle ?? 'this meeting'}” will let you in shortly. Keep this page open.`}>
        <DoorOpen className="h-10 w-10 text-indigo-500" aria-hidden />
        <Button variant="secondary" onClick={leave}>
          Cancel
        </Button>
      </FullMessage>
    );
  }
  if (room.status === 'error') {
    const forbidden = room.error?.code === 'REMOVED' || room.error?.code === 'BAD_PASSWORD';
    const denied = room.error?.code === 'REMOVED';
    return (
      <FullMessage title={denied ? 'Access denied' : 'Could not join the meeting'} code={denied ? '403' : undefined} text={room.error?.message ?? 'Something went wrong.'}>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={leave}>
            Dashboard
          </Button>
          {room.error?.code === 'BAD_PASSWORD' && <Button onClick={onBackToLobby}>Re-enter password</Button>}
          {!forbidden && <Button onClick={() => window.location.reload()}>Try again</Button>}
        </div>
      </FullMessage>
    );
  }
  if (room.status === 'connecting' || !room.self) return <Spinner label="Joining the meeting" />;

  const total = peerList.length + 1;
  const cols = total === 1 ? 'grid-cols-1 max-w-3xl' : total <= 4 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 lg:grid-cols-3';

  return (
    <div className="relative flex h-[100dvh] flex-col bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-800 px-4 py-2 text-sm">
        <h1 className="max-w-[40vw] truncate font-semibold">{room.meeting?.title}</h1>
        <span className="font-mono text-slate-400">{room.meeting?.code}</span>
        <span className="inline-flex items-center gap-1 text-slate-300">
          <Clock className="h-4 w-4" aria-hidden /> <span aria-label="Meeting duration">{elapsed}</span>
        </span>
        <span className="inline-flex items-center gap-1 text-slate-300">
          <Users className="h-4 w-4" aria-hidden /> {total} <span className="sr-only">participants</span>
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-slate-500" title="Media is encrypted in transit (DTLS-SRTP) but not end-to-end encrypted">
          <Lock className="h-3 w-3" aria-hidden /> Encrypted in transit
        </span>
        <CopyButton text={inviteLink(room.meeting?.code ?? code)} className="ml-auto !px-3 !py-1" />
      </header>

      {room.status === 'reconnecting' && (
        <div role="status" className="flex items-center gap-2 bg-amber-500 px-4 py-1.5 text-sm font-medium text-black">
          <WifiOff className="h-4 w-4" aria-hidden /> Connection lost - reconnecting…
        </div>
      )}
      {isHost && room.waitingGuests.length > 0 && !peopleOpen && (
        <div role="status" className="flex flex-wrap items-center gap-3 bg-indigo-600 px-4 py-1.5 text-sm">
          <DoorOpen className="h-4 w-4" aria-hidden />
          {room.waitingGuests.length === 1 ? `${room.waitingGuests[0]!.name} is waiting to join` : `${room.waitingGuests.length} people are waiting to join`}
          <button onClick={togglePeople} className="ml-auto rounded bg-white/20 px-2 py-0.5 font-medium hover:bg-white/30">
            Review
          </button>
        </div>
      )}
      {(media.problem || media.notice || room.screenError) && (
        <div className="space-y-1 px-4 pt-2">
          {media.problem && <Alert kind="info">{media.problem.message} You can still see and hear others.</Alert>}
          {media.notice && <Alert kind="info">{media.notice}</Alert>}
          {room.screenError && <Alert>{room.screenError}</Alert>}
        </div>
      )}

      <ReactionOverlay reactions={room.reactions} />
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 items-center justify-center overflow-y-auto p-3">
          <div className={`grid w-full gap-3 ${cols}`}>
            <VideoTile stream={room.localView} name={room.self.name} isSelf audio={media.audioEnabled} video={media.videoEnabled} screen={room.sharing} isHost={isHost} hand={room.handRaised} />
            {peerList.map((p) => (
              <VideoTile
                key={p.userId}
                stream={room.remoteStreams[p.userId] ?? null}
                name={p.name}
                audio={p.audio}
                video={p.video}
                screen={p.screen}
                isHost={p.role === 'host'}
                hand={p.hand}
                quality={room.quality[p.userId]}
                status={room.connStates[p.userId] ?? 'waiting'}
              />
            ))}
          </div>
          {total === 1 && (
            <p className="sr-only" role="status">
              You are the only participant.
            </p>
          )}
        </main>
        {chatOpen && (
          <div className="absolute inset-y-0 right-0 z-20 sm:static">
            <ChatPanel messages={room.messages} selfId={room.self.userId} onSend={room.sendMessage} onClose={() => setChatOpen(false)} />
          </div>
        )}
        {peopleOpen && (
          <div className="absolute inset-y-0 right-0 z-20 sm:static">
            <ParticipantsPanel
              self={room.self}
              selfAudio={media.audioEnabled}
              selfVideo={media.videoEnabled}
              selfHand={room.handRaised}
              peers={peerList}
              waiting={room.waitingGuests}
              onAdmit={(id) => void room.admitGuest(id)}
              onDeny={(id) => void room.denyGuest(id)}
              connStates={room.connStates}
              isHost={isHost}
              onRemove={(id, name) => {
                if (window.confirm(`Remove ${name} from the meeting? They will not be able to rejoin.`)) void room.removeParticipant(id);
              }}
              onEndForAll={() => {
                if (window.confirm('End this meeting for everyone?')) void room.endForAll();
              }}
              onClose={() => setPeopleOpen(false)}
            />
          </div>
        )}
      </div>

      {total === 1 && (
        <p className="px-4 pb-2 text-center text-sm text-slate-400">Waiting for others to join. Share the invite link to bring people in.</p>
      )}
      <ControlBar
        audioEnabled={media.audioEnabled}
        videoEnabled={media.videoEnabled}
        hasAudio={media.hasAudio}
        hasVideo={media.hasVideo}
        sharing={room.sharing}
        canShare={canShare}
        chatOpen={chatOpen}
        peopleOpen={peopleOpen}
        unread={unread}
        handRaised={room.handRaised}
        waitingCount={isHost ? room.waitingGuests.length : 0}
        onToggleHand={room.toggleHand}
        onReaction={room.sendReaction}
        onToggleAudio={media.toggleAudio}
        onToggleVideo={media.toggleVideo}
        onToggleShare={toggleShare}
        onToggleChat={toggleChat}
        onTogglePeople={togglePeople}
        onLeave={leave}
      />
    </div>
  );
}

function FullMessage({ title, text, code, children }: { title: string; text: string; code?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
      {code && <p className="text-6xl font-bold text-amber-500">{code}</p>}
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="max-w-md text-slate-500">{text}</p>
      {children}
    </div>
  );
}
