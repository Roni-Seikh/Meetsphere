import { useCallback, useEffect, useRef, useState } from 'react';

export type MediaErrorKind = 'unsupported' | 'denied' | 'notfound' | 'inuse' | 'unknown';
export interface MediaProblem {
  kind: MediaErrorKind;
  message: string;
}

export function describeMediaError(err: unknown): MediaProblem {
  const name = (err as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        kind: 'denied',
        message: 'Camera/microphone access was blocked. Click the lock icon in the address bar, allow access, then press Retry.',
      };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return { kind: 'notfound', message: 'No camera or microphone was found on this device.' };
    case 'NotReadableError':
    case 'AbortError':
      return { kind: 'inuse', message: 'Your camera or microphone is being used by another application. Close it and press Retry.' };
    default:
      return { kind: 'unknown', message: 'Could not access your camera or microphone.' };
  }
}

/**
 * Acquires the local camera/microphone with graceful degradation:
 * audio+video -> audio only -> video only -> none (you can still join as a viewer).
 */
export function useLocalMedia() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [problem, setProblem] = useState<MediaProblem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  const request = useCallback(async () => {
    stop();
    setProblem(null);
    setNotice(null);
    setLoading(true);
    if (!navigator.mediaDevices?.getUserMedia) {
      setProblem({
        kind: 'unsupported',
        message: 'This browser (or an insecure http:// page) does not allow camera access. Use HTTPS or localhost in a modern browser.',
      });
      setLoading(false);
      return;
    }
    const attempts: { constraints: MediaStreamConstraints; notice: string | null }[] = [
      { constraints: { audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 } } }, notice: null },
      { constraints: { audio: true }, notice: 'No camera available - you will join with audio only.' },
      { constraints: { video: true }, notice: 'No microphone available - you will join without audio.' },
    ];
    let firstError: unknown = null;
    for (const a of attempts) {
      try {
        const s = await navigator.mediaDevices.getUserMedia(a.constraints);
        streamRef.current = s;
        setStream(s);
        setAudioEnabled(s.getAudioTracks().length > 0);
        setVideoEnabled(s.getVideoTracks().length > 0);
        setNotice(a.notice);
        setLoading(false);
        return;
      } catch (err) {
        firstError ??= err;
        if (describeMediaError(err).kind === 'denied') break; // do not retry when the user said no
      }
    }
    setProblem(describeMediaError(firstError));
    setLoading(false);
  }, [stop]);

  const toggleAudio = useCallback(() => {
    const tracks = streamRef.current?.getAudioTracks() ?? [];
    if (tracks.length === 0) return;
    const next = !tracks[0]!.enabled;
    tracks.forEach((t) => (t.enabled = next));
    setAudioEnabled(next);
  }, []);

  const toggleVideo = useCallback(() => {
    const tracks = streamRef.current?.getVideoTracks() ?? [];
    if (tracks.length === 0) return;
    const next = !tracks[0]!.enabled;
    tracks.forEach((t) => (t.enabled = next));
    setVideoEnabled(next);
  }, []);

  // Release camera/mic when the component using this hook unmounts.
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  return {
    stream,
    problem,
    notice,
    loading,
    audioEnabled,
    videoEnabled,
    hasAudio: (stream?.getAudioTracks().length ?? 0) > 0,
    hasVideo: (stream?.getVideoTracks().length ?? 0) > 0,
    request,
    stop,
    toggleAudio,
    toggleVideo,
  };
}
