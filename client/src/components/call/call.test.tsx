import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { describeMediaError } from '../../hooks/useLocalMedia';
import { extractCode } from '../../lib/api';
import { ChatPanel } from './ChatPanel';
import { ControlBar } from './ControlBar';
import { ParticipantsPanel } from './ParticipantsPanel';
import { ReactionOverlay } from './ReactionOverlay';
import { VideoTile } from './VideoTile';
import { MeetingRow } from '../MeetingList';

describe('ChatPanel', () => {
  it('shows an empty state', () => {
    render(<ChatPanel messages={[]} selfId="me" onSend={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();
  });

  it('renders messages as plain text (no HTML injection)', () => {
    render(
      <ChatPanel
        messages={[{ id: '1', senderId: 'x', senderName: 'Bob', body: '<img src=x onerror=alert(1)>', createdAt: new Date().toISOString() }]}
        selfId="me"
        onSend={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('does not send empty messages and sends trimmed text otherwise', async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true });
    render(<ChatPanel messages={[]} selfId="me" onSend={onSend} onClose={vi.fn()} />);
    const send = screen.getByRole('button', { name: /send message/i });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Message'), 'hello{enter}');
    expect(onSend).toHaveBeenCalledWith('hello');
  });

  it('shows the server error when sending fails', async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: false, error: 'You are sending messages too fast.' });
    render(<ChatPanel messages={[]} selfId="me" onSend={onSend} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Message'), 'spam{enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(/too fast/i);
  });
});

describe('ControlBar', () => {
  const base = {
    audioEnabled: true,
    videoEnabled: true,
    hasAudio: true,
    hasVideo: true,
    sharing: false,
    canShare: true,
    chatOpen: false,
    peopleOpen: false,
    unread: 0,
    handRaised: false,
    waitingCount: 0,
    onToggleHand: vi.fn(),
    onReaction: vi.fn(),
    onToggleAudio: vi.fn(),
    onToggleVideo: vi.fn(),
    onToggleShare: vi.fn(),
    onToggleChat: vi.fn(),
    onTogglePeople: vi.fn(),
    onLeave: vi.fn(),
  };

  it('every control triggers its handler', async () => {
    const h = { ...base, onToggleHand: vi.fn(), onToggleAudio: vi.fn(), onToggleVideo: vi.fn(), onToggleShare: vi.fn(), onToggleChat: vi.fn(), onTogglePeople: vi.fn(), onLeave: vi.fn() };
    render(<ControlBar {...h} />);
    await userEvent.click(screen.getByRole('button', { name: /mute microphone/i }));
    await userEvent.click(screen.getByRole('button', { name: /camera off/i }));
    await userEvent.click(screen.getByRole('button', { name: /^share screen/i }));
    await userEvent.click(screen.getByRole('button', { name: /^chat/i }));
    await userEvent.click(screen.getByRole('button', { name: /participants/i }));
    await userEvent.click(screen.getByRole('button', { name: /leave meeting/i }));
    expect(h.onToggleAudio).toHaveBeenCalledOnce();
    expect(h.onToggleVideo).toHaveBeenCalledOnce();
    expect(h.onToggleShare).toHaveBeenCalledOnce();
    expect(h.onToggleChat).toHaveBeenCalledOnce();
    expect(h.onTogglePeople).toHaveBeenCalledOnce();
    expect(h.onLeave).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: /raise hand/i }));
    expect(h.onToggleHand).toHaveBeenCalledOnce();
  });

  it('sends a reaction from the picker and closes it', async () => {
    const onReaction = vi.fn();
    render(<ControlBar {...base} onReaction={onReaction} />);
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /send a reaction/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /react 🎉/i }));
    expect(onReaction).toHaveBeenCalledWith('🎉');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('shows how many guests are waiting on the participants button and the raised-hand state', () => {
    render(<ControlBar {...base} handRaised waitingCount={2} />);
    expect(screen.getByRole('button', { name: /lower hand/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /participants/i })).toHaveTextContent('2');
  });

  it('reflects state: muted label, disabled controls without devices, unsupported screen share', () => {
    render(<ControlBar {...base} audioEnabled={false} hasVideo={false} canShare={false} unread={3} />);
    expect(screen.getByRole('button', { name: /unmute microphone/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /camera off|camera on/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /not supported/i })).toBeDisabled();
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});

describe('ParticipantsPanel', () => {
  const self = { userId: 's', name: 'Alice', role: 'host' as const, audio: true, video: true, screen: false, hand: false };
  const bob = { userId: 'b', name: 'Bob', role: 'participant' as const, audio: false, video: true, screen: false, hand: false };

  it('shows host-only controls to the host', async () => {
    const onRemove = vi.fn();
    render(<ParticipantsPanel self={self} selfAudio selfVideo selfHand={false} waiting={[]} onAdmit={vi.fn()} onDeny={vi.fn()} peers={[bob]} connStates={{}} isHost onRemove={onRemove} onEndForAll={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Participants (2)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /remove bob/i }));
    expect(onRemove).toHaveBeenCalledWith('b', 'Bob');
    expect(screen.getByRole('button', { name: /end meeting for everyone/i })).toBeInTheDocument();
  });

  it('hides host-only controls from guests', () => {
    render(<ParticipantsPanel self={{ ...bob, userId: 's2' }} selfAudio selfVideo selfHand={false} waiting={[]} onAdmit={vi.fn()} onDeny={vi.fn()} peers={[self]} connStates={{}} isHost={false} onRemove={vi.fn()} onEndForAll={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /end meeting/i })).toBeNull();
  });
});

describe('ParticipantsPanel waiting room and hands', () => {
  const self = { userId: 's', name: 'Alice', role: 'host' as const, audio: true, video: true, screen: false, hand: false };
  const dave = { userId: 'd', name: 'Dave', role: 'participant' as const, audio: true, video: true, screen: false, hand: true };
  const common = { self, selfAudio: true, selfVideo: true, selfHand: false, peers: [dave], connStates: {}, onRemove: vi.fn(), onEndForAll: vi.fn(), onClose: vi.fn() };

  it('lets the host admit or decline waiting guests', async () => {
    const onAdmit = vi.fn();
    const onDeny = vi.fn();
    render(<ParticipantsPanel {...common} isHost waiting={[{ userId: 'w1', name: 'Wendy' }]} onAdmit={onAdmit} onDeny={onDeny} />);
    expect(screen.getByText(/waiting to join \(1\)/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /admit wendy/i }));
    await userEvent.click(screen.getByRole('button', { name: /decline wendy/i }));
    expect(onAdmit).toHaveBeenCalledWith('w1');
    expect(onDeny).toHaveBeenCalledWith('w1');
  });

  it('never shows the waiting list to non-hosts', () => {
    render(<ParticipantsPanel {...common} isHost={false} waiting={[{ userId: 'w1', name: 'Wendy' }]} onAdmit={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.queryByText(/waiting to join/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /admit/i })).toBeNull();
  });

  it('marks participants who raised their hand', () => {
    render(<ParticipantsPanel {...common} isHost={false} waiting={[]} onAdmit={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.getAllByLabelText('Hand raised')).toHaveLength(1);
  });
});

describe('ReactionOverlay and VideoTile indicators', () => {
  it('lists recent reactions with who sent them', () => {
    render(<ReactionOverlay reactions={[{ id: 1, userId: 'b', name: 'Bob', emoji: '🎉' }]} />);
    expect(screen.getByText('🎉')).toBeInTheDocument();
    expect(screen.getByText(/bob reacted with/i)).toBeInTheDocument();
  });

  it('shows hand-raised and connection-quality badges on a remote tile', () => {
    render(<VideoTile stream={null} name="Bob" audio video hand quality="poor" status="connected" />);
    expect(screen.getByText(/hand raised/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Poor connection')).toBeInTheDocument();
  });

  it('does not show quality bars for yourself or while still measuring', () => {
    const { rerender } = render(<VideoTile stream={null} name="Me" isSelf audio video quality="good" />);
    expect(screen.queryByLabelText(/connection/i)).toBeNull();
    rerender(<VideoTile stream={null} name="Bob" audio video quality="unknown" status="connected" />);
    expect(screen.queryByLabelText(/connection/i)).toBeNull();
  });
});

describe('MeetingRow', () => {
  it('links to the room and offers an invite link for live meetings, but not for ended ones', () => {
    const m = { id: '1', code: 'abc-defg-hij', title: 'Standup', status: 'live' as const, scheduledFor: null, startedAt: null, endedAt: null, createdAt: new Date().toISOString(), maxParticipants: 4, hasPassword: true, accessMode: 'open' as const, isHost: false, hostName: 'Alice' };
    const { rerender } = render(
      <MemoryRouter>
        <ul>
          <MeetingRow meeting={m} />
        </ul>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /join/i })).toHaveAttribute('href', '/room/abc-defg-hij');
    expect(screen.getByRole('button', { name: /invite link/i })).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <ul>
          <MeetingRow meeting={{ ...m, status: 'ended' }} />
        </ul>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: /join/i })).toBeNull();
  });
});

describe('helpers', () => {
  it('maps browser media errors to friendly messages', () => {
    expect(describeMediaError({ name: 'NotAllowedError' }).kind).toBe('denied');
    expect(describeMediaError({ name: 'NotFoundError' }).kind).toBe('notfound');
    expect(describeMediaError({ name: 'NotReadableError' }).kind).toBe('inuse');
    expect(describeMediaError(new Error('x')).kind).toBe('unknown');
  });
  it('extracts meeting codes from pasted links', () => {
    expect(extractCode('https://meetsphere.app/room/abc-defg-hij')).toBe('abc-defg-hij');
    expect(extractCode('ABC-DEFG-HIJ')).toBe('abc-defg-hij');
    expect(extractCode('hello')).toBeNull();
  });
});
