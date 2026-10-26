import { env } from './env';
import { getAccessToken } from './supabase';

export interface Meeting {
  id: string;
  code: string;
  title: string;
  status: 'scheduled' | 'live' | 'ended';
  scheduledFor: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  maxParticipants: number;
  hasPassword: boolean;
  accessMode: 'open' | 'waiting_room';
  isHost: boolean;
  hostName: string | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the MeetSphere server. If it was idle it may be waking up - try again in a minute.');
  }
  const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? 'ERROR', body?.error?.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export const api = {
  listMeetings: () => request<{ meetings: Meeting[] }>('/api/meetings').then((r) => r.meetings),
  getMeeting: (code: string) => request<{ meeting: Meeting }>(`/api/meetings/${code}`).then((r) => r.meeting),
  createMeeting: (input: { title: string; scheduledFor?: string | null; password?: string | null; maxParticipants: number; accessMode: 'open' | 'waiting_room' }) =>
    request<{ meeting: Meeting }>('/api/meetings', { method: 'POST', body: JSON.stringify(input) }).then((r) => r.meeting),
  endMeeting: (code: string) => request<{ ok: true }>(`/api/meetings/${code}/end`, { method: 'POST' }),
  getMe: () => request<{ id: string; displayName: string }>('/api/me'),
  updateMe: (displayName: string) =>
    request<{ id: string; displayName: string }>('/api/me', { method: 'PATCH', body: JSON.stringify({ displayName }) }),
};

export function inviteLink(code: string): string {
  return `${window.location.origin}/room/${code}`;
}

export function extractCode(input: string): string | null {
  const m = input.trim().toLowerCase().match(/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:[/?#].*)?$/);
  return m?.[1] ?? null;
}
