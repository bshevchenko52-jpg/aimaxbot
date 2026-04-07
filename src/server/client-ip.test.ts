import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { getClientIp } from './client-ip';

function req(partial: Partial<Request> & { socket?: { remoteAddress?: string } }): Request {
  return partial as Request;
}

describe('getClientIp', () => {
  // B2: getClientIp теперь использует req.ip (учитывает trust proxy), а не X-Forwarded-For

  it('возвращает req.ip если он задан', () => {
    const r = req({
      ip: '185.71.76.1',
      socket: { remoteAddress: '127.0.0.1' },
    });
    expect(getClientIp(r)).toBe('185.71.76.1');
  });

  it('fallback на socket.remoteAddress если req.ip не задан', () => {
    const r = req({
      socket: { remoteAddress: '::1' },
    });
    expect(getClientIp(r)).toBe('::1');
  });

  it('возвращает пустую строку если нет IP', () => {
    const r = req({
      socket: {},
    });
    expect(getClientIp(r)).toBe('');
  });

  it('возвращает req.ip даже если socket есть', () => {
    const r = req({
      ip: '10.0.0.5',
      socket: { remoteAddress: '127.0.0.1' },
    });
    expect(getClientIp(r)).toBe('10.0.0.5');
  });

  it('socket отсутствует и req.ip не задан — возвращает пустую строку', () => {
    // socket может быть undefined в тестовом окружении
    const r = { ip: undefined } as unknown as Request;
    // не должен падать с TypeError
    expect(() => getClientIp(r)).not.toThrow();
  });
});
