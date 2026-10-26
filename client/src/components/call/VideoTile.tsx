import { Hand, MicOff, Monitor, VideoOff } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { QUALITY_LABEL, type QualityLevel } from '../../lib/webrtc/quality';

const BAR_COUNT: Record<QualityLevel, number> = { good: 3, fair: 2, poor: 1, unknown: 0 };
const BAR_COLOR: Record<QualityLevel, string> = { good: 'bg-emerald-400', fair: 'bg-amber-400', poor: 'bg-red-500', unknown: 'bg-slate-500' };

function QualityBars({ level }: { level: QualityLevel }) {
  return (
    <span role="img" aria-label={QUALITY_LABEL[level]} title={QUALITY_LABEL[level]} className="flex h-4 items-end gap-0.5">
      {[1, 2, 3].map((n) => (
        <span key={n} className={`w-1 rounded-sm ${n <= BAR_COUNT[level] ? BAR_COLOR[level] : 'bg-slate-600'}`} style={{ height: `${n * 5 + 2}px` }} />
      ))}
    </span>
  );
}

interface Props {
  stream: MediaStream | null;
  name: string;
  isSelf?: boolean;
  audio: boolean;
  video: boolean;
  screen?: boolean;
  isHost?: boolean;
  hand?: boolean;
  quality?: QualityLevel;
  status?: RTCPeerConnectionState | 'waiting';
}

export function VideoTile({ stream, name, isSelf, audio, video, screen, isHost, hand, quality, status }: Props) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);

  const hasVideo = !!stream && stream.getVideoTracks().length > 0 && (video || screen);
  const connecting = !isSelf && status && status !== 'connected';
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  return (
    <div
      className="relative aspect-video overflow-hidden rounded-xl bg-slate-800 ring-1 ring-slate-700"
      aria-label={`${name}${isSelf ? ' (you)' : ''}, microphone ${audio ? 'on' : 'off'}, camera ${video ? 'on' : 'off'}`}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={isSelf} // never play our own microphone back to ourselves
        className={`h-full w-full ${screen ? 'object-contain bg-black' : 'object-cover'} ${isSelf && !screen ? '-scale-x-100' : ''} ${hasVideo ? '' : 'invisible'}`}
      />
      {!hasVideo && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-indigo-600 text-2xl font-semibold text-white">{initial}</span>
        </div>
      )}
      {hand && (
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-xs font-medium text-black">
          <Hand className="h-3.5 w-3.5" aria-hidden /> Hand raised
        </span>
      )}
      {!connecting && !isSelf && quality && quality !== 'unknown' && (
        <span className="absolute right-2 top-2 rounded bg-black/50 p-1">
          <QualityBars level={quality} />
        </span>
      )}
      {connecting && (
        <span className="absolute right-2 top-2 rounded-full bg-amber-500/90 px-2 py-0.5 text-xs font-medium text-black">
          {status === 'failed' ? 'Connection failed' : status === 'disconnected' ? 'Reconnecting…' : 'Connecting…'}
        </span>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 text-sm text-white">
        <span className="truncate font-medium">
          {name}
          {isSelf && ' (You)'}
        </span>
        {isHost && <span className="rounded bg-indigo-500/80 px-1.5 text-[10px] uppercase tracking-wide">Host</span>}
        {screen && <Monitor className="h-3.5 w-3.5 text-emerald-300" aria-label="Sharing screen" />}
        <span className="ml-auto flex items-center gap-1.5">
          {!audio && <MicOff className="h-4 w-4 text-red-400" aria-label="Muted" />}
          {!video && !screen && <VideoOff className="h-4 w-4 text-red-400" aria-label="Camera off" />}
        </span>
      </div>
    </div>
  );
}
