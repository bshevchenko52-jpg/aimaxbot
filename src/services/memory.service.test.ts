import { describe, expect, it } from 'vitest';
import { parseStoredMessages } from './memory.service';

describe('parseStoredMessages', () => {
  it('возвращает [] для не-массива', () => {
    expect(parseStoredMessages(null)).toEqual([]);
    expect(parseStoredMessages({})).toEqual([]);
    expect(parseStoredMessages('x')).toEqual([]);
  });

  it('фильтрует элементы без role/content', () => {
    expect(
      parseStoredMessages([
        { role: 'user', content: 'hi' },
        { foo: 1 },
        null,
        { role: 'assistant', content: 'ok' },
      ]),
    ).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'ok' },
    ]);
  });

  it('нормализует неизвестный role в user', () => {
    expect(parseStoredMessages([{ role: 'tool', content: 'x' }])).toEqual([{ role: 'user', content: 'x' }]);
  });

  it('приводит content к строке', () => {
    expect(parseStoredMessages([{ role: 'user', content: 42 as unknown as string }])).toEqual([
      { role: 'user', content: '42' },
    ]);
  });

  it('system сохраняется', () => {
    expect(parseStoredMessages([{ role: 'system', content: 'sys' }])).toEqual([{ role: 'system', content: 'sys' }]);
  });
});
