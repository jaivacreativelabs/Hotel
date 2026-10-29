import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

const ok = () => new Response(JSON.stringify({ data: { saved: true } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const keyOf = (call: unknown[]) => ((call[1] as RequestInit).headers as Record<string, string>)['idempotency-key'];

afterEach(() => vi.unstubAllGlobals());

describe('requests whose answer never arrives', () => {
  it('are sent again with the same request key', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Load failed')).mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', fetch);
    expect(await api.patch('/menu/items/1', { name: 'Idly' })).toEqual({ saved: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(keyOf(fetch.mock.calls[0])).toMatch(/^rq_[0-9a-f]{32}$/);
    expect(keyOf(fetch.mock.calls[1])).toBe(keyOf(fetch.mock.calls[0]));
  });

  it('also when Vercel answers that the function did not run', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', fetch);
    expect(await api.get('/menu/items')).toEqual({ saved: true });
    expect(keyOf(fetch.mock.calls[0])).toBeUndefined(); // reads need no key
  });

  it('give up after three tries with the connection message', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetch);
    const err = await api.post('/expenses', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).isNetwork).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('a new save gets a new key', async () => {
    const fetch = vi.fn().mockImplementation(async () => ok());
    vi.stubGlobal('fetch', fetch);
    await api.post('/expenses', {});
    await api.post('/expenses', {});
    expect(keyOf(fetch.mock.calls[0])).not.toBe(keyOf(fetch.mock.calls[1]));
  });
});
