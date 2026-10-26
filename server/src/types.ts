export interface AuthUser {
  id: string;
  name: string;
}

/** Verifies a bearer token and returns the user, or null when invalid. */
export type Authenticator = (token: string) => Promise<AuthUser | null>;

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export const MEETING_CODE_RE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
