import type { ApiError } from '../../../lib/api-types.ts';

const REQUEST_TIMEOUT_MS = 30_000;

export class ApiRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

export type ApiClientOptions = {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  /** Called when the server rejects the token (revoked or expired). */
  onUnauthorized?: () => void;
  fetcher?: typeof fetch;
};

export function createApiClient({ baseUrl, getToken, onUnauthorized, fetcher = fetch }: ApiClientOptions) {
  async function request<T>(path: string, init: RequestInit = {}, authed = true): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body !== undefined && !headers.has('Content-Type'))
      headers.set('Content-Type', 'application/json');
    if (authed) {
      const token = await getToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
    }
    // A flaky connection must not leave a screen or a Save button spinning forever.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    let body: (T & Partial<ApiError>) | null;
    try {
      response = await fetcher(`${baseUrl}${path}`, { ...init, headers, signal: init.signal ?? controller.signal });
      body = (await response.json().catch(() => null)) as (T & Partial<ApiError>) | null;
    } catch {
      throw new ApiRequestError('Could not reach Sipwise. Check your connection.', 0);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      if (response.status === 401 && authed) onUnauthorized?.();
      throw new ApiRequestError(body?.error ?? `Request failed (${response.status}).`, response.status);
    }
    return body as T;
  }

  return {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, data?: unknown, authed = true) =>
      request<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) }, authed),
    put: <T>(path: string, data: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(data) }),
    delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
