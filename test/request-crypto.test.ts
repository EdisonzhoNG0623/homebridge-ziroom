import { describe, expect, it } from 'vitest';
import { decodeDes, encodeDes } from '../src/request/crypto';

describe('Ziroom DES compatibility', () => {
  it('matches a DES-CBC vector on OpenSSL 3 runtimes', () => {
    expect(encodeDes('ok')).toBe('c37371e57c0a18f2');
  });

  it('round trips unicode API payloads', () => {
    const payload = JSON.stringify({ code: '200', message: '窗帘已打开' });
    expect(decodeDes(encodeDes(payload))).toBe(payload);
  });
});
