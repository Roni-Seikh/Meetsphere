export type QualityLevel = 'good' | 'fair' | 'poor' | 'unknown';

export interface QualitySample {
  rttMs: number | null;
  lossPct: number | null;
}

/**
 * Turns raw WebRTC stats into a simple traffic-light rating.
 * Thresholds follow common VoIP guidance: round-trip > 150 ms or loss > 3 % is noticeable,
 * round-trip > 400 ms or loss > 8 % is poor.
 */
export function classifyQuality(sample: QualitySample | null): QualityLevel {
  if (!sample || (sample.rttMs === null && sample.lossPct === null)) return 'unknown';
  const rtt = sample.rttMs ?? 0;
  const loss = sample.lossPct ?? 0;
  if (rtt > 400 || loss > 8) return 'poor';
  if (rtt > 150 || loss > 3) return 'fair';
  return 'good';
}

export const QUALITY_LABEL: Record<QualityLevel, string> = {
  good: 'Good connection',
  fair: 'Fair connection',
  poor: 'Poor connection',
  unknown: 'Measuring connection',
};
