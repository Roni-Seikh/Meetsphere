import { describe, expect, it, vi } from 'vitest';
import { PeerManager } from './PeerManager';

class FakeTrack {
  constructor(
    public kind: 'audio' | 'video',
    public id = `${kind}-1`,
  ) {}
}
class FakeStream {
  tracks: FakeTrack[] = [];
  getTracks() {
    return this.tracks;
  }
  addTrack(t: FakeTrack) {
    this.tracks.push(t);
  }
}

class FakePC {
  static instances: FakePC[] = [];
  signalingState = 'stable';
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  connectionState = 'new';
  added: RTCIceCandidateInit[] = [];
  tracks: unknown[] = [];
  transceivers: unknown[] = [];
  closed = false;
  onicecandidate: unknown = null;
  ontrack: unknown = null;
  onnegotiationneeded: unknown = null;
  onconnectionstatechange: unknown = null;
  constructor() {
    FakePC.instances.push(this);
  }
  addTrack(t: unknown) {
    this.tracks.push(t);
  }
  addTransceiver(kind: string, init: unknown) {
    this.transceivers.push({ kind, init });
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    this.remoteDescription = d;
    this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable';
  }
  async setLocalDescription() {
    this.localDescription = { type: this.signalingState === 'have-remote-offer' ? 'answer' : 'offer', sdp: 'sdp' };
    this.signalingState = this.localDescription.type === 'answer' ? 'stable' : 'have-local-offer';
  }
  async addIceCandidate(c: RTCIceCandidateInit) {
    if (!this.remoteDescription) throw new Error('no remote description');
    this.added.push(c);
  }
  close() {
    this.closed = true;
  }
  restartIce() {}
  stats: Record<string, unknown>[] = [];
  async getStats() {
    return { forEach: (cb: (s: Record<string, unknown>) => void) => this.stats.forEach(cb) };
  }
  getTransceivers() {
    return [];
  }
}

function setup(selfId = 'b') {
  FakePC.instances = [];
  const sent = { desc: [] as [string, RTCSessionDescriptionInit][], ice: [] as [string, RTCIceCandidateInit][] };
  const local = new FakeStream();
  local.tracks = [new FakeTrack('audio'), new FakeTrack('video')];
  const pm = new PeerManager({
    selfId,
    iceServers: [],
    getLocalStream: () => local as unknown as MediaStream,
    sendDescription: (to, d) => sent.desc.push([to, d]),
    sendIce: (to, c) => sent.ice.push([to, c]),
    onRemoteStream: vi.fn(),
    onConnectionState: vi.fn(),
    createPeerConnection: () => new FakePC() as unknown as RTCPeerConnection,
    createStream: () => new FakeStream() as unknown as MediaStream,
  });
  return { pm, sent };
}

describe('PeerManager', () => {
  it('creates exactly one connection per peer even if asked repeatedly', async () => {
    const { pm } = setup();
    pm.connectTo('a');
    pm.connectTo('a');
    await pm.handleIce('a', { candidate: 'c' });
    expect(FakePC.instances).toHaveLength(1);
    expect(pm.size).toBe(1);
  });

  it('adds local audio and video tracks to every connection', () => {
    const { pm } = setup();
    pm.connectTo('a');
    expect(FakePC.instances[0]!.tracks).toHaveLength(2);
  });

  it('falls back to receive-only transceivers when there is no local device', () => {
    FakePC.instances = [];
    const pm = new PeerManager({
      selfId: 'b',
      iceServers: [],
      getLocalStream: () => null,
      sendDescription: vi.fn(),
      sendIce: vi.fn(),
      onRemoteStream: vi.fn(),
      onConnectionState: vi.fn(),
      createPeerConnection: () => new FakePC() as unknown as RTCPeerConnection,
      createStream: () => new FakeStream() as unknown as MediaStream,
    });
    pm.connectTo('a');
    expect(FakePC.instances[0]!.transceivers).toHaveLength(2);
  });

  it('queues ICE candidates until the remote description is set, then flushes them', async () => {
    const { pm } = setup();
    await pm.handleIce('a', { candidate: 'c1' });
    await pm.handleIce('a', { candidate: 'c2' });
    const pc = FakePC.instances[0]!;
    expect(pc.added).toHaveLength(0);
    await pm.handleDescription('a', { type: 'offer', sdp: 'x' });
    expect(pc.added.map((c) => c.candidate)).toEqual(['c1', 'c2']);
    await pm.handleIce('a', { candidate: 'c3' });
    expect(pc.added).toHaveLength(3);
  });

  it('answers an incoming offer', async () => {
    const { pm, sent } = setup();
    await pm.handleDescription('a', { type: 'offer', sdp: 'x' });
    expect(sent.desc).toHaveLength(1);
    expect(sent.desc[0]![0]).toBe('a');
    expect(sent.desc[0]![1].type).toBe('answer');
  });

  it('impolite peer ignores a colliding offer; polite peer accepts it', async () => {
    // self "b" vs remote "a": b > a so b is impolite.
    const impolite = setup('b');
    impolite.pm.connectTo('a');
    const pc1 = FakePC.instances[0]!;
    pc1.signalingState = 'have-local-offer';
    await impolite.pm.handleDescription('a', { type: 'offer', sdp: 'x' });
    expect(pc1.remoteDescription).toBeNull();

    // self "a" vs remote "b": a < b so a is polite.
    const polite = setup('a');
    polite.pm.connectTo('b');
    const pc2 = FakePC.instances[0]!;
    pc2.signalingState = 'have-local-offer';
    await polite.pm.handleDescription('b', { type: 'offer', sdp: 'x' });
    expect(pc2.remoteDescription?.type).toBe('offer');
  });

  it('closes and forgets peers; dispose stops further handling', async () => {
    const { pm } = setup();
    pm.connectTo('a');
    pm.connectTo('c');
    const [pa] = FakePC.instances;
    pm.removePeer('a');
    expect(pa!.closed).toBe(true);
    expect(pm.size).toBe(1);
    pm.dispose();
    expect(pm.size).toBe(0);
    await pm.handleDescription('z', { type: 'offer', sdp: 'x' });
    expect(FakePC.instances).toHaveLength(2);
  });

  it('measures round-trip time and packet loss between two samples', async () => {
    const { pm } = setup();
    pm.connectTo('a');
    const pc = FakePC.instances[0]!;
    pc.stats = [
      { type: 'candidate-pair', nominated: true, currentRoundTripTime: 0.12 },
      { type: 'inbound-rtp', packetsLost: 5, packetsReceived: 95 },
    ];
    expect(await pm.measure('a')).toEqual({ rttMs: 120, lossPct: 5 });
    pc.stats = [
      { type: 'candidate-pair', nominated: true, currentRoundTripTime: 0.05 },
      { type: 'inbound-rtp', packetsLost: 5, packetsReceived: 195 }, // 100 more packets, none lost
    ];
    expect(await pm.measure('a')).toEqual({ rttMs: 50, lossPct: 0 });
  });

  it('returns null for unknown peers and lists connected ids', async () => {
    const { pm } = setup();
    expect(await pm.measure('nobody')).toBeNull();
    pm.connectTo('a');
    pm.connectTo('c');
    expect(pm.ids().sort()).toEqual(['a', 'c']);
  });
});
