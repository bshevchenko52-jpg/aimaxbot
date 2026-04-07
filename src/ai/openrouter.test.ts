import { afterEach, describe, expect, it, vi } from 'vitest';
import { completeChat } from './openrouter';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('completeChat', () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it('возвращает текст ответа при успехе', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '  hello  ' } }],
      }),
    });

    const text = await completeChat([], 'привет');
    expect(text).toBe('hello');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('https://openrouter.ai/api/v1/chat/completions');
    const init = call[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init.body as string);
    expect(body.model).toBeTruthy();
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1]).toEqual({ role: 'user', content: 'привет' });
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer /);
    expect(headers['X-OpenRouter-Title']).toBeDefined();
    expect(headers['HTTP-Referer']).toBeDefined();
  });

  it('пробрасывает ошибку при !res.ok', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 402,
      statusText: 'Payment',
      json: async () => ({ error: { message: 'no credits' } }),
    });

    await expect(completeChat([], 'x')).rejects.toThrow(/credits|нейросети/);
  });

  it('бросает при пустом choices/content', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '' } }] }),
    });

    await expect(completeChat([], 'x')).rejects.toThrow('Пустой ответ');
  });
});
