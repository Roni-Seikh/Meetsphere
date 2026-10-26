/**
 * PeerManager owns every RTCPeerConnection of a call (mesh topology: one per remote participant).
 *
 * Design notes (also see docs/signalling-protocol.md):
 *  - One connection per userId, created idempotently by ensurePeer() => no duplicate connections.
 *  - "Perfect negotiation": the peer with the lexicographically smaller userId is "polite" and rolls
 *    back on offer collisions, so simultaneous offers can never deadlock the connection.
 *  - ICE candidates that arrive before the remote description are queued and flushed afterwards.
 *  - Screen sharing swaps the outgoing video track with replaceTrack (no renegotiation needed).
 *  - The media transport is purely browser <-> browser; signalling only carries SDP/ICE.
 */
import type { QualitySample } from './quality';

export interface PeerManagerOptions {
  selfId: string;
  iceServers: RTCIceServer[];
  getLocalStream: () => MediaStream | null;
  sendDescription: (to: string, description: RTCSessionDescriptionInit) => void;
  sendIce: (to: string, candidate: RTCIceCandidateInit) => void;
  onRemoteStream: (userId: string, stream: MediaStream) => void;
  onConnectionState: (userId: string, state: RTCPeerConnectionState) => void;
  /** Injectable for tests. */
  createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection;
  createStream?: () => MediaStream;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  suppressNegotiation: boolean;
  pendingIce: RTCIceCandidateInit[];
  remoteStream: MediaStream;
  announced: boolean;
  prevLost: number;
  prevReceived: number;
}

export class PeerManager {
  private readonly peers = new Map<string, PeerEntry>();
  private closed = false;

  constructor(private readonly opts: PeerManagerOptions) {}

  has(userId: string): boolean {
    return this.peers.has(userId);
  }

  get size(): number {
    return this.peers.size;
  }

  ids(): string[] {
    return [...this.peers.keys()];
  }

  /** Reads round-trip time and packet loss (since the previous call) for one connection. */
  async measure(userId: string): Promise<QualitySample | null> {
    const entry = this.peers.get(userId);
    if (!entry || typeof entry.pc.getStats !== 'function') return null;
    try {
      const report = await entry.pc.getStats();
      let rttMs: number | null = null;
      let lost = 0;
      let received = 0;
      report.forEach((stat: Record<string, unknown>) => {
        if (stat.type === 'candidate-pair' && (stat.nominated === true || stat.state === 'succeeded') && typeof stat.currentRoundTripTime === 'number') {
          rttMs = stat.currentRoundTripTime * 1000;
        }
        if (stat.type === 'inbound-rtp') {
          lost += typeof stat.packetsLost === 'number' ? stat.packetsLost : 0;
          received += typeof stat.packetsReceived === 'number' ? stat.packetsReceived : 0;
        }
      });
      const dLost = Math.max(0, lost - entry.prevLost);
      const dReceived = Math.max(0, received - entry.prevReceived);
      entry.prevLost = lost;
      entry.prevReceived = received;
      const total = dLost + dReceived;
      return { rttMs, lossPct: total > 0 ? (dLost / total) * 100 : null };
    } catch {
      return null;
    }
  }

  /** Start a connection to a peer (called for each existing participant when we join). */
  connectTo(userId: string): void {
    this.ensurePeer(userId, false);
  }

  async handleDescription(from: string, description: RTCSessionDescriptionInit): Promise<void> {
    if (this.closed) return;
    const isNew = !this.peers.has(from);
    const entry = this.ensurePeer(from, isNew && description.type === 'offer');
    const pc = entry.pc;
    const collision = description.type === 'offer' && (entry.makingOffer || pc.signalingState !== 'stable');
    entry.ignoreOffer = !entry.polite && collision;
    if (entry.ignoreOffer) return;
    try {
      await pc.setRemoteDescription(description); // polite peer: implicit rollback of its own offer
      entry.suppressNegotiation = false;
      await this.flushIce(entry);
      if (description.type === 'offer') {
        await pc.setLocalDescription();
        const local = pc.localDescription;
        if (local) this.opts.sendDescription(from, { type: local.type, sdp: local.sdp });
      }
    } catch (err) {
      console.error('[webrtc] failed to apply description', err);
    }
  }

  async handleIce(from: string, candidate: RTCIceCandidateInit): Promise<void> {
    if (this.closed) return;
    const entry = this.ensurePeer(from, !this.peers.has(from));
    if (!entry.pc.remoteDescription) {
      entry.pendingIce.push(candidate); // queue until the remote description is set
      return;
    }
    try {
      await entry.pc.addIceCandidate(candidate);
    } catch (err) {
      if (!entry.ignoreOffer) console.error('[webrtc] addIceCandidate failed', err);
    }
  }

  removePeer(userId: string): void {
    const entry = this.peers.get(userId);
    if (!entry) return;
    this.peers.delete(userId);
    const pc = entry.pc;
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onnegotiationneeded = null;
    pc.onconnectionstatechange = null;
    try {
      pc.close();
    } catch {
      /* already closed */
    }
  }

  closeAll(): void {
    for (const id of [...this.peers.keys()]) this.removePeer(id);
  }

  dispose(): void {
    this.closed = true;
    this.closeAll();
  }

  /** Swap the outgoing video track (screen share <-> camera) on every connection. */
  async replaceVideoTrack(track: MediaStreamTrack | null): Promise<void> {
    await Promise.all(
      [...this.peers.values()].map(async ({ pc }) => {
        const transceiver = pc.getTransceivers().find((t) => t.receiver.track.kind === 'video');
        if (!transceiver) return;
        if (track && transceiver.direction === 'recvonly') transceiver.direction = 'sendrecv'; // triggers one renegotiation
        try {
          await transceiver.sender.replaceTrack(track);
        } catch (err) {
          console.error('[webrtc] replaceTrack failed', err);
        }
      }),
    );
  }

  // ---------------------------------------------------------------------------------------------

  private ensurePeer(userId: string, suppressNegotiation: boolean): PeerEntry {
    const existing = this.peers.get(userId);
    if (existing) return existing;

    const make = this.opts.createPeerConnection ?? ((c: RTCConfiguration) => new RTCPeerConnection(c));
    const pc = make({ iceServers: this.opts.iceServers });
    const entry: PeerEntry = {
      pc,
      polite: this.opts.selfId < userId,
      makingOffer: false,
      ignoreOffer: false,
      suppressNegotiation,
      pendingIce: [],
      remoteStream: this.opts.createStream ? this.opts.createStream() : new MediaStream(),
      announced: false,
      prevLost: 0,
      prevReceived: 0,
    };
    this.peers.set(userId, entry);

    pc.onicecandidate = (e) => {
      if (e.candidate) this.opts.sendIce(userId, e.candidate.toJSON());
    };

    pc.ontrack = (e) => {
      if (!entry.remoteStream.getTracks().some((t) => t.id === e.track.id)) entry.remoteStream.addTrack(e.track);
      if (!entry.announced) {
        entry.announced = true;
        this.opts.onRemoteStream(userId, entry.remoteStream);
      }
    };

    pc.onnegotiationneeded = async () => {
      if (entry.suppressNegotiation || this.peers.get(userId) !== entry) return;
      try {
        entry.makingOffer = true;
        await pc.setLocalDescription();
        const local = pc.localDescription;
        if (local) this.opts.sendDescription(userId, { type: local.type, sdp: local.sdp });
      } catch (err) {
        console.error('[webrtc] negotiation failed', err);
      } finally {
        entry.makingOffer = false;
      }
    };

    pc.onconnectionstatechange = () => {
      this.opts.onConnectionState(userId, pc.connectionState);
      if (pc.connectionState === 'failed') pc.restartIce(); // retry through new candidate pairs / TURN
    };

    this.addLocalTracks(entry);
    return entry;
  }

  private addLocalTracks(entry: PeerEntry): void {
    const local = this.opts.getLocalStream();
    for (const kind of ['audio', 'video'] as const) {
      const track = local?.getTracks().find((t) => t.kind === kind);
      if (track && local) entry.pc.addTrack(track, local);
      else entry.pc.addTransceiver(kind, { direction: 'recvonly' }); // still receive when we have no device
    }
  }

  private async flushIce(entry: PeerEntry): Promise<void> {
    const queued = entry.pendingIce.splice(0);
    for (const c of queued) {
      try {
        await entry.pc.addIceCandidate(c);
      } catch (err) {
        if (!entry.ignoreOffer) console.error('[webrtc] queued ICE failed', err);
      }
    }
  }
}
