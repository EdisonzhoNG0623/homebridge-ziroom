import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeDes } from '../src/request/crypto';

const refreshedToken = `header.${Buffer.from(JSON.stringify({ uid: 'test-user' })).toString('base64url')}.signature`;
const loginMock = vi.fn(async () => refreshedToken);

vi.mock('../src/request/login', () => ({
  login: loginMock,
}));

const { ZiroomRequest } = await import('../src/request');

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('ZiroomRequest authentication retries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stops after three refreshed tokens are rejected', async () => {
    const expiredResponse = encodeDes(JSON.stringify({ code: '40005', data: null, message: 'token expired' }));
    const fetchMock = vi.fn(async () => new Response(expiredResponse));
    vi.stubGlobal('fetch', fetchMock);
    const request = new ZiroomRequest(logger as never, {
      token: refreshedToken,
      account: 'account',
      password: 'password',
    });

    await expect(request.request('/test', {})).rejects.toThrow('重试 3 次');
    expect(loginMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('limits concurrent API requests to three', async () => {
    const successResponse = encodeDes(JSON.stringify({ code: '200', data: { ok: true } }));
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const fetchMock = vi.fn(async () => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeRequests -= 1;
      return new Response(successResponse);
    });
    vi.stubGlobal('fetch', fetchMock);
    const request = new ZiroomRequest(logger as never, { token: refreshedToken });

    await Promise.all(Array.from({ length: 10 }, (_, index) => request.request(`/test/${index}`, {})));

    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(maxActiveRequests).toBe(3);
  });
});
