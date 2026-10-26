import { Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { InCall } from '../components/call/InCall';
import { Alert, Button, Card, Field, Spinner } from '../components/ui';
import { useLocalMedia } from '../hooks/useLocalMedia';
import { api, ApiError, type Meeting } from '../lib/api';

/** Lobby: look up the meeting, preview camera/mic, enter password if needed, then join. */
export default function RoomPage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const media = useLocalMedia();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [password, setPassword] = useState('');
  const [joined, setJoined] = useState(false);
  const previewRef = useRef<HTMLVideoElement>(null);
  const requestMedia = media.request;

  useEffect(() => {
    let active = true;
    api
      .getMeeting(code)
      .then((m) => active && setMeeting(m))
      .catch((e: unknown) => active && setLoadError(e instanceof ApiError ? e : new ApiError(0, 'ERROR', 'Could not load meeting.')));
    return () => {
      active = false;
    };
  }, [code]);

  useEffect(() => {
    void requestMedia();
  }, [requestMedia]);

  useEffect(() => {
    if (previewRef.current) previewRef.current.srcObject = media.stream;
  }, [media.stream, joined]);

  if (loadError) {
    const notFound = loadError.status === 404;
    return (
      <div className="mx-auto max-w-md px-4 pt-16">
        <Card className="space-y-4 text-center">
          <h1 className="text-xl font-semibold">{notFound ? 'Meeting not found' : 'Could not load meeting'}</h1>
          <p className="text-sm text-slate-500">{notFound ? 'Check the code or link and try again.' : loadError.message}</p>
          <Link to="/dashboard" className="text-sm font-medium text-indigo-600">
            Back to dashboard
          </Link>
        </Card>
      </div>
    );
  }
  if (!meeting) return <div className="pt-16"><Spinner label="Loading meeting" /></div>;

  if (meeting.status === 'ended') {
    return (
      <div className="mx-auto max-w-md px-4 pt-16">
        <Card className="space-y-3 text-center">
          <h1 className="text-xl font-semibold">This meeting has ended</h1>
          <p className="text-sm text-slate-500">{meeting.title}</p>
          <Button onClick={() => navigate('/dashboard')}>Back to dashboard</Button>
        </Card>
      </div>
    );
  }

  if (joined) {
    return (
      <InCall
        code={meeting.code}
        password={password || undefined}
        media={media}
        onBackToLobby={() => {
          setPassword('');
          setJoined(false);
        }}
      />
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setJoined(true);
  };
  const needsPassword = meeting.hasPassword && !meeting.isHost;
  const waitingForHost = !meeting.isHost && meeting.status === 'scheduled';

  return (
    <div className="mx-auto grid max-w-4xl gap-6 px-4 py-10 md:grid-cols-[3fr_2fr]">
      <div>
        <div className="relative aspect-video overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-slate-700">
          <video ref={previewRef} autoPlay playsInline muted className={`h-full w-full -scale-x-100 object-cover ${media.stream && media.videoEnabled && media.hasVideo ? '' : 'invisible'}`} />
          {!(media.stream && media.videoEnabled && media.hasVideo) && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-400">
              {media.loading ? <Spinner label="Starting camera" /> : <span>Camera is off</span>}
            </div>
          )}
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-3">
            <button onClick={media.toggleAudio} disabled={!media.hasAudio} aria-label={media.audioEnabled ? 'Mute microphone' : 'Unmute microphone'} className={`rounded-full p-3 text-white disabled:opacity-40 ${media.audioEnabled ? 'bg-slate-700' : 'bg-red-600'}`}>
              {media.audioEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </button>
            <button onClick={media.toggleVideo} disabled={!media.hasVideo} aria-label={media.videoEnabled ? 'Turn camera off' : 'Turn camera on'} className={`rounded-full p-3 text-white disabled:opacity-40 ${media.videoEnabled ? 'bg-slate-700' : 'bg-red-600'}`}>
              {media.videoEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            </button>
          </div>
        </div>
        <div className="mt-3 space-y-2">
          {media.problem && (
            <Alert>
              <p>{media.problem.message}</p>
              <button onClick={() => void media.request()} className="mt-1 font-medium underline">
                Retry
              </button>
              <p className="mt-1 text-xs opacity-80">You can still join without a camera or microphone and watch and listen.</p>
            </Alert>
          )}
          {media.notice && <Alert kind="info">{media.notice}</Alert>}
        </div>
      </div>

      <Card className="h-fit space-y-4">
        <div>
          <h1 className="text-xl font-semibold">{meeting.title}</h1>
          <p className="text-sm text-slate-500">
            Hosted by {meeting.isHost ? 'you' : (meeting.hostName ?? 'unknown')} · <span className="font-mono">{meeting.code}</span>
          </p>
        </div>
        {meeting.accessMode === 'waiting_room' && !meeting.isHost && <Alert kind="info">This meeting has a waiting room. The host will admit you after you press join.</Alert>}
        {waitingForHost && <Alert kind="info">The host has not started this meeting yet. You can join once they do.</Alert>}
        <form onSubmit={submit} className="space-y-3">
          {needsPassword && (
            <Field label="Meeting password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="off" />
          )}
          <Button type="submit" className="w-full" disabled={needsPassword && !password}>
            {meeting.isHost ? 'Start meeting' : 'Join now'}
          </Button>
        </form>
        {waitingForHost && (
          <Button variant="secondary" className="w-full" onClick={() => window.location.reload()}>
            Check again
          </Button>
        )}
      </Card>
    </div>
  );
}
