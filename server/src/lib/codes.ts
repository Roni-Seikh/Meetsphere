import { randomInt } from 'node:crypto';

// No i/l/o to avoid look-alike characters.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz';

function chunk(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** Generates a meeting code like "abc-defg-hij" (cryptographically random). */
export function generateMeetingCode(): string {
  return `${chunk(3)}-${chunk(4)}-${chunk(3)}`;
}

/** Accepts a bare code or a full invite URL and returns the normalised code (or null). */
export function extractMeetingCode(input: string): string | null {
  const match = input.trim().toLowerCase().match(/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:[/?#].*)?$/);
  return match?.[1] ?? null;
}
