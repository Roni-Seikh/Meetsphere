import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { env } from '../lib/env';
import { getAccessToken } from '../lib/supabase';
import { PeerManager } from '../lib/webrtc/PeerManager';
import { classifyQuality, type QualityLevel } from '../lib/webrtc/quality';

export interface PeerInfo {
  userId: string;
  name: string;
  role: 'host' | 'participant';
  audio: boolean;
  video: boolean;
  screen: boolean;
  hand: boolean;
}
export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
}
export interface WaitingGuest {
  userId: string;
  name: string;
}
export interface FloatingReaction {
  id: number;
  userId: string;
  name: string;
  emoji: string;
}
export type RoomStatus = 'connecting' | 'waiting' | 'joined' | 'reconnecting' | 'ended' | 'removed' | 'replaced' | 'denied' | 'error';
interface JoinOk {
  ok: true;
  self: PeerInfo;
  peers: PeerInfo[];
  iceServers: RTCIceServer[];
  messages: ChatMessage[];
  meeting: { id: string; code: string; title: string; startedAt: string | null; maxParticipants: number };
}
interface JoinWaiting {
  ok: true;
  waiting: true;
  meeting: { code: string; title: string };
}
interface JoinErr {
  ok: false;
  code: string;
  error: string;
}
type Ack = { ok: boolean; error?: string };

interface Options {
  code: string;
  password?: string;
  stream: MediaStream | null;
  audioEnabled: boolean;
  videoEnabled: boolean;
}

/** All real-time call state: signalling socket, peer connections, participants, chat, screen share. */
export function useMeetingRoom({ code, password, stream, audioEnabled, videoEnabled }: Options) {
  const [status, setStatus] = useState<RoomStatus>('connecting');
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [self, setSelf] = useState<PeerInfo | null>(null);
  const [meeting, setMeeting] = useState<JoinOk['meeting'] | null>(null);
  const [waitingTitle, setWaitingTitle] = useState<string | null>(null);
  const [peers, setPeers] = useState<Record<string, PeerInfo>>({});
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [connStates, setConnStates] = useState<Record<string, RTCPeerConnectionState>>({});
  const [quality, setQuality] = useState<Record<string, QualityLevel>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [waitingGuests, setWaitingGuests] = useState<WaitingGuest[]>([]);
  const [handRaised, setHandRaised] = useState(false);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [sharing, setSharing] = useState(false);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [localView, setLocalView] = useState<MediaStream | null>(stream);

  const socketRef = useRef<Socket | null>(null);
  const pmRef = useRef<PeerManager | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const streamRef = useRef(stream);
  const mediaRef = useRef({ audio: audioEnabled, video: videoEnabled, screen: false });
  const joinedRef = useRef(false);
  const handRef = useRef(false);
  const reactionId = useRef(0);
  const reactionTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const stopSharingRef = useRef<() => void>(() => undefined);
  streamRef.current = stream;
  mediaRef.current = { audio: audioEnabled, video: videoEnabled, screen: sharing };

  const resetRemote = useCallback(() => {
    pmRef.current?.dispose();
    pmRef.current = null;
    setPeers({});
    setRemoteStreams({});
    setConnStates({});
    setQuality({});
  }, []);

  const stopSharing = useCallback(() => {
    const track = screenTrackRef.current;
    if (!track) return;
    screenTrackRef.current = null;
    track.onended = null;
    track.stop();
    const camera = streamRef.current?.getVideoTracks()[0] ?? null;
    void pmRef.current?.replaceVideoTrack(camera); // restore the camera (or nothing if there is none)
    setLocalView(streamRef.current);
    setSharing(false);
  }, []);
  stopSharingRef.current = stopSharing;

  useEffect(() => {
    let disposed = false;
    const timers = reactionTimers.current;
    const socket = io(env.apiUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      auth: (cb) => {
        void getAccessToken().then((token) => cb({ token: token ?? '' })); // fresh token on every (re)connect
      },
    });
    socketRef.current = socket;

    const finish = (s: RoomStatus) => {
      if (disposed) return;
      joinedRef.current = false;
      stopSharingRef.current();
      resetRemote();
      setWaitingGuests([]);
      setStatus(s);
      socket.disconnect(); // do not auto-rejoin after being ended/removed/replaced/declined
    };

    const joinRoom = () => {
      setStatus((s) => (s === 'reconnecting' || s === 'joined' ? 'reconnecting' : 'connecting'));
      socket.emit(
        'room:join',
        { code, password: password || undefined, media: { audio: mediaRef.current.audio, video: mediaRef.current.video } },
        (res: JoinOk | JoinWaiting | JoinErr) => {
          if (disposed) return;
          if (!res.ok) {
            setError({ code: res.code, message: res.error });
            finish('error');
            return;
          }
          if ('waiting' in res) {
            // Waiting room: the host has to let us in; we get "waiting:admitted" and then join again.
            joinedRef.current = false;
            resetRemote();
            setWaitingTitle(res.meeting.title);
            setStatus('waiting');
            return;
          }
          // Re-join after reconnect: drop all previous connections and rebuild them from scratch.
          resetRemote();
          const pm = new PeerManager({
            selfId: res.self.userId,
            iceServers: res.iceServers,
            getLocalStream: () => streamRef.current,
            sendDescription: (to, data) => socket.emit('signal:description', { to, data }),
            sendIce: (to, data) => socket.emit('signal:ice', { to, data }),
            onRemoteStream: (userId, s) => setRemoteStreams((m) => ({ ...m, [userId]: s })),
            onConnectionState: (userId, state) => setConnStates((m) => ({ ...m, [userId]: state })),
          });
          pmRef.current = pm;
          handRef.current = false;
          setHandRaised(false);
          setSelf(res.self);
          setMeeting(res.meeting);
          setMessages(res.messages);
          setPeers(Object.fromEntries(res.peers.map((p) => [p.userId, p])));
          // The newcomer initiates connections to everyone already in the room.
          res.peers.forEach((p) => pm.connectTo(p.userId));
          joinedRef.current = true;
          setError(null);
          setStatus('joined');
        },
      );
    };

    socket.on('connect', joinRoom);
    socket.on('disconnect', (reason) => {
      if (disposed || reason === 'io client disconnect') return;
      joinedRef.current = false;
      setStatus((s) => (s === 'waiting' ? 'connecting' : 'reconnecting'));
    });
    socket.on('connect_error', (err) => {
      if (disposed) return;
      if (err.message === 'unauthorized') {
        setError({ code: 'UNAUTHENTICATED', message: 'Your session expired. Please sign in again.' });
        finish('error');
      } else {
        setStatus((s) => (s === 'joined' ? 'reconnecting' : s));
      }
    });

    socket.on('peer:joined', (peer: PeerInfo) => {
      pmRef.current?.removePeer(peer.userId); // a rejoining user gets a fresh connection
      setRemoteStreams((m) => omit(m, peer.userId));
      setPeers((m) => ({ ...m, [peer.userId]: peer }));
    });
    socket.on('peer:left', ({ userId }: { userId: string }) => {
      pmRef.current?.removePeer(userId);
      setPeers((m) => omit(m, userId));
      setRemoteStreams((m) => omit(m, userId));
      setConnStates((m) => omit(m, userId));
      setQuality((m) => omit(m, userId));
    });
    socket.on('signal:description', ({ from, data }: { from: string; data: RTCSessionDescriptionInit }) => {
      void pmRef.current?.handleDescription(from, data);
    });
    socket.on('signal:ice', ({ from, data }: { from: string; data: RTCIceCandidateInit }) => {
      void pmRef.current?.handleIce(from, data);
    });
    socket.on('chat:message', (m: ChatMessage) => {
      setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
    });
    socket.on('media:state', (s: { userId: string } & Pick<PeerInfo, 'audio' | 'video' | 'screen'>) => {
      setPeers((m) => (m[s.userId] ? { ...m, [s.userId]: { ...m[s.userId]!, audio: s.audio, video: s.video, screen: s.screen } } : m));
    });
    socket.on('hand:state', ({ userId, raised }: { userId: string; raised: boolean }) => {
      setPeers((m) => (m[userId] ? { ...m, [userId]: { ...m[userId]!, hand: raised } } : m));
    });
    socket.on('reaction', (r: { userId: string; name: string; emoji: string }) => {
      const id = ++reactionId.current;
      setReactions((list) => [...list.slice(-5), { id, ...r }]);
      const t = setTimeout(() => {
        timers.delete(t);
        setReactions((list) => list.filter((x) => x.id !== id));
      }, 3500);
      timers.add(t);
    });
    socket.on('waiting:list', (list: WaitingGuest[]) => setWaitingGuests(list));
    socket.on('waiting:admitted', joinRoom);
    socket.on('waiting:denied', () => finish('denied'));
    socket.on('room:ended', () => finish('ended'));
    socket.on('room:removed', () => finish('removed'));
    socket.on('room:replaced', () => finish('replaced'));

    return () => {
      disposed = true;
      stopSharingRef.current();
      if (socket.connected) socket.emit('room:leave');
      socket.removeAllListeners();
      socket.disconnect();
      pmRef.current?.dispose();
      pmRef.current = null;
      socketRef.current = null;
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, [code, password, resetRemote]);

  // Publish mic / camera / screen indicators whenever they change.
  useEffect(() => {
    if (status === 'joined') {
      socketRef.current?.emit('media:state', { audio: audioEnabled, video: videoEnabled, screen: sharing });
    }
  }, [status, audioEnabled, videoEnabled, sharing]);

  // Poll connection statistics every few seconds for the network-quality indicators.
  useEffect(() => {
    if (status !== 'joined') return;
    let cancelled = false;
    const tick = async () => {
      const pm = pmRef.current;
      if (!pm) return;
      const entries = await Promise.all(pm.ids().map(async (id) => [id, classifyQuality(await pm.measure(id))] as const));
      if (!cancelled) setQuality(Object.fromEntries(entries));
    };
    const timer = setInterval(() => void tick(), 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [status]);

  const sendMessage = useCallback((body: string): Promise<{ ok: boolean; error?: string }> => {
    const trimmed = body.trim();
    if (!trimmed) return Promise.resolve({ ok: false, error: 'Type a message first.' });
    if (trimmed.length > 2000) return Promise.resolve({ ok: false, error: 'Messages are limited to 2000 characters.' });
    const socket = socketRef.current;
    if (!socket?.connected || !joinedRef.current) return Promise.resolve({ ok: false, error: 'Reconnecting - try again in a moment.' });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: 'No response from the server.' }), 8000);
      socket.emit('chat:send', { body: trimmed }, (ack: Ack) => {
        clearTimeout(timer);
        resolve(ack);
      });
    });
  }, []);

  const startSharing = useCallback(async () => {
    setScreenError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setScreenError('Screen sharing is not supported in this browser.');
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = display.getVideoTracks()[0];
      if (!track) return;
      screenTrackRef.current = track;
      track.onended = () => stopSharingRef.current(); // user clicked the browser's "Stop sharing" bar
      await pmRef.current?.replaceVideoTrack(track);
      setLocalView(new MediaStream([track, ...(streamRef.current?.getAudioTracks() ?? [])]));
      setSharing(true);
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'NotAllowedError') setScreenError('Screen sharing was cancelled or blocked.');
      else setScreenError('Could not start screen sharing.');
    }
  }, []);

  const toggleHand = useCallback(() => {
    if (!joinedRef.current) return;
    const next = !handRef.current;
    handRef.current = next;
    setHandRaised(next);
    socketRef.current?.emit('hand:set', { raised: next });
  }, []);

  const sendReaction = useCallback((emoji: string) => {
    if (joinedRef.current) socketRef.current?.emit('reaction:send', { emoji });
  }, []);

  const removeParticipant = useCallback((userId: string): Promise<Ack> => {
    return new Promise((resolve) => socketRef.current?.emit('host:remove', { userId }, resolve));
  }, []);
  const endForAll = useCallback((): Promise<Ack> => {
    return new Promise((resolve) => socketRef.current?.emit('host:end', resolve));
  }, []);
  const admitGuest = useCallback((userId: string): Promise<Ack> => {
    return new Promise((resolve) => socketRef.current?.emit('host:admit', { userId }, resolve));
  }, []);
  const denyGuest = useCallback((userId: string): Promise<Ack> => {
    return new Promise((resolve) => socketRef.current?.emit('host:deny', { userId }, resolve));
  }, []);

  // Keep the self-view in sync if the camera stream is replaced before sharing.
  useEffect(() => {
    if (!screenTrackRef.current) setLocalView(stream);
  }, [stream]);

  return {
    status,
    error,
    self,
    meeting,
    waitingTitle,
    peers,
    remoteStreams,
    connStates,
    quality,
    messages,
    waitingGuests,
    handRaised,
    reactions,
    sharing,
    screenError,
    localView,
    sendMessage,
    startSharing,
    stopSharing,
    toggleHand,
    sendReaction,
    removeParticipant,
    endForAll,
    admitGuest,
    denyGuest,
  };
}

function omit<T>(obj: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = obj;
  void _removed;
  return rest;
}
