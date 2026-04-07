import { getConfig } from '../config';
import { log } from '../lib/logger';

type ORMessage = { role: 'system' | 'user' | 'assistant'; content: string };

interface UrlCitation {
  url: string;
  title?: string;
  content?: string;
}

interface Annotation {
  type: 'url_citation';
  url_citation: UrlCitation;
}

interface ORChoice {
  message?: {
    content?: string | null;
    annotations?: Annotation[];
  };
  finish_reason?: string;
}

interface ChatCompletionResponse {
  choices?: ORChoice[];
  error?: { message?: string };
  usage?: {
    server_tool_use?: { web_search_requests?: number };
  };
}

/** Извлекает уникальные источники из annotations и форматирует их. */
function formatSources(annotations: Annotation[] | undefined): string {
  if (!annotations?.length) return '';
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const a of annotations) {
    if (a.type === 'url_citation') {
      const { url, title } = a.url_citation;
      if (!seen.has(url)) {
        seen.add(url);
        lines.push(title ? `[${title}](${url})` : url);
      }
    }
  }
  if (!lines.length) return '';
  return '\n\n**Источники:**\n' + lines.map((l) => `• ${l}`).join('\n');
}

export async function completeChat(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string,
): Promise<string> {
  const cfg = getConfig();
  const messages: ORMessage[] = [
    { role: 'system', content: cfg.SYSTEM_PROMPT },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const body: Record<string, unknown> = {
    model: cfg.AI_MODEL,
    messages,
    temperature: 0.7,
  };

  // perplexity/* ищет нативно — server tools не нужны и не поддерживаются
  const isPerplexity = cfg.AI_MODEL.startsWith('perplexity/');

  if (cfg.WEB_SEARCH_ENABLED && !isPerplexity) {
    body.tools = [
      {
        type: 'openrouter:web_search',
        parameters: {
          max_results: 3,
          max_total_results: 9,
          search_context_size: 'medium',
          user_location: { type: 'approximate', country: 'RU', timezone: 'Europe/Moscow' },
        },
      },
    ];
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(90_000),
    headers: {
      Authorization: `Bearer ${cfg.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': cfg.OPENROUTER_REFERER,
      'X-OpenRouter-Title': cfg.OPENROUTER_TITLE,
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as ChatCompletionResponse;

  if (!res.ok) {
    const msg = data.error?.message ?? res.statusText;
    log.error('OpenRouter error', { status: res.status, msg, raw: JSON.stringify(data).slice(0, 300) });
    throw new Error(`Ошибка нейросети: ${msg}`);
  }

  const choice = data.choices?.[0];
  const text = choice?.message?.content?.trim();
  if (!text) {
    throw new Error('Пустой ответ модели');
  }

  const searches = data.usage?.server_tool_use?.web_search_requests;
  if (searches) {
    log.debug(`Web search: ${searches} запрос(ов) для "${userMessage.slice(0, 60)}"`);
  }

  return text + formatSources(choice?.message?.annotations);
}
