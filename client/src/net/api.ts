// HTTP calls to the auth API and orchestrator. The access token lives in
// memory only; the refresh token is kept in localStorage to stay signed in.

export interface PlayerView {
  id: string;
  display_name: string;
  look: number;
  trust_tier: string;
  minor: boolean;
}

export interface Session {
  access_token: string;
  access_expires_in: number;
  refresh_token: string;
  player: PlayerView;
}

export interface SignupRequired {
  signup_required: true;
  signup_token: string;
  email: string;
}

export interface JoinTicket {
  server_url: string;
  zone_id: string;
  instance_id: number;
  join_token: string;
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

const REFRESH_KEY = "commons.refresh";

async function post<T>(path: string, body: unknown, bearer?: string): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "network", "Can't reach Commons right now. Check your connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "error", data.message ?? `Request failed (${res.status})`);
  return data as T;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export class Auth {
  private session: Session | null = null;
  private expiresAt = 0;

  get player(): PlayerView | null {
    return this.session?.player ?? null;
  }

  private adopt(s: Session) {
    this.session = s;
    this.expiresAt = Date.now() + s.access_expires_in * 1000;
    storage()?.setItem(REFRESH_KEY, s.refresh_token);
  }

  signOut() {
    this.session = null;
    storage()?.removeItem(REFRESH_KEY);
  }

  /** Restores a session from the stored refresh token, if any. */
  async resume(): Promise<boolean> {
    const token = storage()?.getItem(REFRESH_KEY);
    if (!token) return false;
    try {
      this.adopt(await post<Session>("/api/auth/refresh", { refresh_token: token }));
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) storage()?.removeItem(REFRESH_KEY);
      return false;
    }
  }

  requestLink(email: string) {
    return post<{ sent: boolean; dev_link?: string }>("/api/auth/magic-link", { email });
  }

  /** Exchanges a magic-link token. Returns sign-up details for new emails. */
  async verify(token: string): Promise<SignupRequired | null> {
    const res = await post<Session | SignupRequired>("/api/auth/verify", { token });
    if ("signup_required" in res) return res;
    this.adopt(res);
    return null;
  }

  async signup(signupToken: string, displayName: string, birthYear: number) {
    this.adopt(
      await post<Session>("/api/auth/signup", {
        signup_token: signupToken,
        display_name: displayName,
        birth_year: birthYear,
      }),
    );
  }

  async devLogin(displayName: string) {
    this.adopt(await post<Session>("/api/auth/dev-login", { display_name: displayName }));
  }

  /** A valid access token, refreshing it if it is about to expire. */
  async accessToken(): Promise<string> {
    if (!this.session) throw new ApiError(401, "unauthorized", "Not signed in");
    if (Date.now() > this.expiresAt - 60_000) {
      this.adopt(await post<Session>("/api/auth/refresh", { refresh_token: this.session.refresh_token }));
    }
    return this.session!.access_token;
  }

  async join(zoneId: string): Promise<JoinTicket> {
    return post<JoinTicket>("/api/join", { zone_id: zoneId }, await this.accessToken());
  }
}
