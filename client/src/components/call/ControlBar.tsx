import { Hand, Mic, MicOff, MessageSquare, MonitorUp, MonitorX, PhoneOff, Smile, Users, Video, VideoOff } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { REACTIONS } from '../../lib/reactions';

interface BtnProps {
  label: string;
  onClick: () => void;
  active?: boolean;
  off?: boolean;
  disabled?: boolean;
  badge?: number;
  children: ReactNode;
  shortcut?: string;
}

function RoundButton({ label, onClick, active, off, disabled, badge, children, shortcut }: BtnProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active ?? off}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={`relative flex h-11 w-11 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        off ? 'bg-red-600 text-white hover:bg-red-500' : active ? 'bg-indigo-600 text-white hover:bg-indigo-500' : 'bg-slate-700 text-white hover:bg-slate-600'
      }`}
    >
      {children}
      {!!badge && (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-500 px-1 text-[11px] font-semibold">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
}

interface Props {
  audioEnabled: boolean;
  videoEnabled: boolean;
  hasAudio: boolean;
  hasVideo: boolean;
  sharing: boolean;
  canShare: boolean;
  chatOpen: boolean;
  peopleOpen: boolean;
  unread: number;
  handRaised: boolean;
  waitingCount: number;
  onToggleHand: () => void;
  onReaction: (emoji: string) => void;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleShare: () => void;
  onToggleChat: () => void;
  onTogglePeople: () => void;
  onLeave: () => void;
}

export function ControlBar(p: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div role="toolbar" aria-label="Meeting controls" className="flex flex-wrap items-center justify-center gap-3 border-t border-slate-800 bg-slate-900 px-4 py-3">
      <RoundButton label={p.audioEnabled ? 'Mute microphone' : 'Unmute microphone'} shortcut="M" onClick={p.onToggleAudio} off={!p.audioEnabled} disabled={!p.hasAudio}>
        {p.audioEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
      </RoundButton>
      <RoundButton label={p.videoEnabled ? 'Turn camera off' : 'Turn camera on'} shortcut="V" onClick={p.onToggleVideo} off={!p.videoEnabled} disabled={!p.hasVideo}>
        {p.videoEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
      </RoundButton>
      <RoundButton
        label={p.sharing ? 'Stop sharing screen' : p.canShare ? 'Share screen' : 'Screen sharing is not supported on this device'}
        shortcut="S"
        onClick={p.onToggleShare}
        active={p.sharing}
        disabled={!p.canShare}
      >
        {p.sharing ? <MonitorX className="h-5 w-5" /> : <MonitorUp className="h-5 w-5" />}
      </RoundButton>
      <RoundButton label="Chat" shortcut="C" onClick={p.onToggleChat} active={p.chatOpen} badge={p.chatOpen ? 0 : p.unread}>
        <MessageSquare className="h-5 w-5" />
      </RoundButton>
      <RoundButton label={p.handRaised ? 'Lower hand' : 'Raise hand'} shortcut="H" onClick={p.onToggleHand} active={p.handRaised}>
        <Hand className="h-5 w-5" />
      </RoundButton>
      <div className="relative">
        <RoundButton label="Send a reaction" onClick={() => setPickerOpen((o) => !o)} active={pickerOpen}>
          <Smile className="h-5 w-5" />
        </RoundButton>
        {pickerOpen && (
          <div role="menu" aria-label="Reactions" className="absolute bottom-14 left-1/2 z-30 flex -translate-x-1/2 gap-1 rounded-full bg-slate-800 p-2 shadow-lg ring-1 ring-slate-700">
            {REACTIONS.map((emoji) => (
              <button
                key={emoji}
                role="menuitem"
                aria-label={`React ${emoji}`}
                onClick={() => {
                  p.onReaction(emoji);
                  setPickerOpen(false);
                }}
                className="h-9 w-9 rounded-full text-xl hover:bg-slate-700"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
      <RoundButton label="Participants" shortcut="P" onClick={p.onTogglePeople} active={p.peopleOpen} badge={p.waitingCount}>
        <Users className="h-5 w-5" />
      </RoundButton>
      <button
        onClick={p.onLeave}
        aria-label="Leave meeting"
        title="Leave meeting"
        className="flex h-11 items-center gap-2 rounded-full bg-red-600 px-5 text-sm font-medium text-white hover:bg-red-500"
      >
        <PhoneOff className="h-5 w-5" aria-hidden />
        Leave
      </button>
    </div>
  );
}
