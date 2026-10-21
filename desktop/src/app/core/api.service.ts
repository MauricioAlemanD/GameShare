import { Injectable } from '@angular/core';
import { ApiError, friendlyMessage, networkErrorMessage } from './errors';
import { Credentials, IceConfig, InviteView, SessionView } from './models';

interface RequestOptions {
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/** Cliente REST del backend de coordinación. Todos los errores se convierten en ApiError con un mensaje legible. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  static readonly TIMEOUT_MS = 10_000;

  async request<T>(baseUrl: string, method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    let res: Response;
    try {
      res = await fetch(baseUrl + path, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(ApiService.TIMEOUT_MS),
      });
    } catch {
      throw new ApiError(0, 'NETWORK', networkErrorMessage(baseUrl));
    }
    if (res.status === 204) {
      return undefined as T;
    }
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      /* respuesta sin JSON */
    }
    if (!res.ok) {
      const err = (data ?? {}) as { error?: string; message?: string };
      throw new ApiError(res.status, err.error ?? `HTTP_${res.status}`, friendlyMessage(err.error, err.message, res.status));
    }
    return data as T;
  }

  createSession(base: string, displayName: string, hostKey: string | null): Promise<Credentials> {
    return this.request(base, 'POST', '/api/sessions', {
      body: { displayName },
      headers: hostKey ? { 'X-Host-Key': hostKey } : {},
    });
  }

  getSession(base: string, c: Credentials): Promise<SessionView> {
    return this.request(base, 'GET', `/api/sessions/${c.sessionId}`, { token: c.token });
  }

  closeSession(base: string, c: Credentials): Promise<void> {
    return this.request(base, 'DELETE', `/api/sessions/${c.sessionId}`, { token: c.token });
  }

  createInvite(base: string, c: Credentials): Promise<InviteView> {
    return this.request(base, 'POST', `/api/sessions/${c.sessionId}/invites`, { token: c.token });
  }

  listInvites(base: string, c: Credentials): Promise<InviteView[]> {
    return this.request(base, 'GET', `/api/sessions/${c.sessionId}/invites`, { token: c.token });
  }

  revokeInvite(base: string, c: Credentials, inviteId: string): Promise<InviteView> {
    return this.request(base, 'DELETE', `/api/sessions/${c.sessionId}/invites/${inviteId}`, { token: c.token });
  }

  redeem(base: string, code: string, displayName: string): Promise<Credentials> {
    return this.request(base, 'POST', '/api/invites/redeem', { body: { code, displayName } });
  }

  approve(base: string, c: Credentials, pid: string): Promise<SessionView> {
    return this.request(base, 'POST', `/api/sessions/${c.sessionId}/participants/${pid}/approve`, { token: c.token });
  }

  reject(base: string, c: Credentials, pid: string): Promise<SessionView> {
    return this.request(base, 'POST', `/api/sessions/${c.sessionId}/participants/${pid}/reject`, { token: c.token });
  }

  removeParticipant(base: string, c: Credentials, pid: string): Promise<void> {
    return this.request(base, 'DELETE', `/api/sessions/${c.sessionId}/participants/${pid}`, { token: c.token });
  }

  setGamepad(base: string, c: Credentials, pid: string, gamepad: boolean): Promise<SessionView> {
    return this.request(base, 'PUT', `/api/sessions/${c.sessionId}/participants/${pid}/permissions`, {
      token: c.token,
      body: { gamepad },
    });
  }

  iceServers(base: string, c: Credentials): Promise<IceConfig> {
    return this.request(base, 'GET', `/api/sessions/${c.sessionId}/ice-servers`, { token: c.token });
  }
}
