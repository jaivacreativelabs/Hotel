import { BRANCH_HEADER, CSRF_HEADER, CSRF_HEADER_VALUE, type PageMeta } from '@rb/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** true when the request never reached the server (offline, server down). */
  get isNetwork() {
    return this.status === 0;
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

interface RequestOptions {
  query?: Query;
  body?: unknown;
  form?: FormData;
  /** Overrides the active branch for this request; `null` sends none. */
  branchId?: string | null;
  signal?: AbortSignal;
}

const AUTH_PROBES = new Set(['/auth/login', '/auth/me', '/auth/demo-login', '/auth/demo-accounts']);

let activeBranchId: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setApiBranch(id: string | null) {
  activeBranchId = id;
}
export function getApiBranch() {
  return activeBranchId;
}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return `/api/v1${path}${qs ? `?${qs}` : ''}`;
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<{ data: T; meta?: PageMeta }> {
  const headers: Record<string, string> = { Accept: 'application/json', [CSRF_HEADER]: CSRF_HEADER_VALUE };
  const branch = opts.branchId === undefined ? activeBranchId : opts.branchId;
  if (branch) headers[BRANCH_HEADER] = branch;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), { method, headers, body, credentials: 'same-origin', signal: opts.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
  }

  if (res.status === 204) return { data: undefined as T };
  const json = await res.json().catch(() => null);
  if (!res.ok) throw failure(res.status, json, path);
  return json as { data: T; meta?: PageMeta };
}

function failure(status: number, json: { error?: { code?: string; message?: string; details?: unknown } } | null, path: string): ApiError {
  const e = json?.error ?? {};
  // A 401 from these auth calls just means "not signed in" – not an expired session – so it
  // must not trigger the sign-out handler (which also clears cached data such as the
  // login page's demo buttons).
  if (status === 401 && onUnauthorized && !AUTH_PROBES.has(path)) onUnauthorized();
  return new ApiError(status, e.code ?? 'HTTP_ERROR', e.message ?? `Request failed (${status})`, e.details);
}

/**
 * A synchronous request: the page waits until the server answers. Only for printing a bill
 * straight from the tap that generated it – Safari (iPad) prints only from a tap, and a normal
 * request would end the tap before the bill exists.
 */
function requestSync<T>(method: string, path: string, opts: RequestOptions = {}): T {
  const xhr = new XMLHttpRequest();
  xhr.open(method, buildUrl(path, opts.query), false);
  xhr.setRequestHeader('Accept', 'application/json');
  xhr.setRequestHeader(CSRF_HEADER, CSRF_HEADER_VALUE);
  const branch = opts.branchId === undefined ? activeBranchId : opts.branchId;
  if (branch) xhr.setRequestHeader(BRANCH_HEADER, branch);
  if (opts.body !== undefined) xhr.setRequestHeader('Content-Type', 'application/json');
  try {
    xhr.send(opts.body === undefined ? null : JSON.stringify(opts.body));
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
  }
  if (xhr.status === 0) throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
  if (xhr.status === 204) return undefined as T;
  let json = null;
  try {
    json = JSON.parse(xhr.responseText);
  } catch {
    // not JSON – handled below
  }
  if (xhr.status < 200 || xhr.status >= 300) throw failure(xhr.status, json, path);
  return (json as { data: T }).data;
}

export const apiSync = {
  get: <T>(path: string, opts?: RequestOptions) => requestSync<T>('GET', path, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => requestSync<T>('POST', path, { ...opts, body: body ?? {} }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => requestSync<T>('PUT', path, { ...opts, body }),
};

export const api = {
  get: async <T>(path: string, opts?: RequestOptions) => (await request<T>('GET', path, opts)).data,
  page: async <T>(path: string, opts?: RequestOptions) => {
    const r = await request<T[]>('GET', path, opts);
    return { data: r.data, meta: r.meta! };
  },
  post: async <T>(path: string, body?: unknown, opts?: RequestOptions) => (await request<T>('POST', path, { ...opts, body: body ?? {} })).data,
  put: async <T>(path: string, body?: unknown, opts?: RequestOptions) => (await request<T>('PUT', path, { ...opts, body })).data,
  patch: async <T>(path: string, body?: unknown, opts?: RequestOptions) => (await request<T>('PATCH', path, { ...opts, body })).data,
  delete: async <T = void>(path: string, opts?: RequestOptions) => (await request<T>('DELETE', path, opts)).data,
  upload: async <T>(path: string, form: FormData, opts?: RequestOptions) => (await request<T>('POST', path, { ...opts, form })).data,
};

/** Downloads a server-generated file (CSV) using the session cookie. */
export async function downloadFile(path: string, query: Query, fallbackName: string): Promise<void> {
  const headers: Record<string, string> = { [CSRF_HEADER]: CSRF_HEADER_VALUE };
  if (activeBranchId) headers[BRANCH_HEADER] = activeBranchId;
  const res = await fetch(buildUrl(path, query), { headers, credentials: 'same-origin' });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new ApiError(res.status, json?.error?.code ?? 'HTTP_ERROR', json?.error?.message ?? 'Download failed');
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
