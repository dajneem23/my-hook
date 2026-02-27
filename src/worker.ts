export interface Env {
  LOG_STORE: DurableObjectNamespace;
  ASSETS: Fetcher;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

const MAX_LOGS = 200;

interface StoredLog {
  id: string;
  timestamp: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (isHtmlRoute(url.pathname)) {
      const assetUrl = new URL('/viewer.html', request.url);
      const assetRequest = new Request(assetUrl.toString(), request);
      const assetResponse = await env.ASSETS.fetch(assetRequest);
      if (assetResponse.status !== 404) return assetResponse;
    }

    if (url.pathname === '/webhook' && request.method === 'POST') {
      const entry = await buildLogEntry(request, url.pathname);
      const stub = env.LOG_STORE.get(env.LOG_STORE.idFromName('global'));
      // Durable Object stub fetch: origin is arbitrary but must be a valid URL.
      const response = await stub.fetch('https://log-store.internal/append', {
        method: 'POST',
        body: JSON.stringify(entry),
        headers: { 'content-type': 'application/json' },
      });

      if (!response.ok) return new Response('Failed to persist webhook', { status: 500 });
      const { id, total } = (await response.json()) as { id: string; total: number };
      await sendToTelegram(entry, env);
      return jsonResponse({ status: 'accepted', id, total }, 202);
    }

    if (url.pathname === '/logs' && request.method === 'GET') {
      const stub = env.LOG_STORE.get(env.LOG_STORE.idFromName('global'));
      return stub.fetch('https://log-store.internal/logs');
    }

    if (url.pathname === '/logs' && request.method === 'DELETE') {
      const stub = env.LOG_STORE.get(env.LOG_STORE.idFromName('global'));
      return stub.fetch('https://log-store.internal/logs', { method: 'DELETE' });
    }

    return new Response('Not found', { status: 404 });
  },
};

export class LogStore {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/append' && request.method === 'POST') {
      const entry = (await request.json()) as StoredLog;
      const logs = (await this.state.storage.get<StoredLog[]>('logs')) ?? [];
      logs.push(entry);
      if (logs.length > MAX_LOGS) {
        logs.splice(0, logs.length - MAX_LOGS);
      }
      await this.state.storage.put('logs', logs);
      return jsonResponse({ id: entry.id, total: logs.length }, 202);
    }

    if (url.pathname === '/logs' && request.method === 'GET') {
      const logs = (await this.state.storage.get<StoredLog[]>('logs')) ?? [];
      return jsonResponse({ logs });
    }

    if (url.pathname === '/logs' && request.method === 'DELETE') {
      await this.state.storage.delete('logs');
      return jsonResponse({ cleared: true });
    }

    return new Response('Not found', { status: 404 });
  }
}

async function buildLogEntry(request: Request, path: string): Promise<StoredLog> {
  const body = await readBody(request);
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    path,
    headers: pickHeaders(request.headers),
    body,
  } satisfies StoredLog;
}

function pickHeaders(headers: Headers): Record<string, string> {
  const keep = ['content-type', 'user-agent', 'cf-connecting-ip', 'x-forwarded-for'];
  const output: Record<string, string> = {};
  for (const key of keep) {
    const value = headers.get(key);
    if (value) output[key] = value;
  }
  return output;
}

async function readBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? '';
  const raw = await request.text();
  const trimmed = raw.slice(0, 8000);

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      return { malformed: true, raw: trimmed };
    }
  }

  if (contentType.startsWith('text/')) return trimmed;
  return { note: 'binary or unknown content type', base64: btoa(trimmed) };
}

function isHtmlRoute(pathname: string): boolean {
  return pathname === '/' || pathname === '/view';
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function sendToTelegram(entry: StoredLog, env: Env): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const preview = JSON.stringify(entry.body).slice(0, 800);
  const text = `Webhook received %0AID: ${encodeURIComponent(entry.id)}%0AWhen: ${encodeURIComponent(entry.timestamp)}%0APath: ${encodeURIComponent(entry.path)}%0AHeaders: ${encodeURIComponent(JSON.stringify(entry.headers))}%0ABody: ${encodeURIComponent(preview)}`;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `chat_id=${encodeURIComponent(chatId)}&text=${text}`,
    });
  } catch (error) {
    console.error('Failed to send Telegram notification', error);
  }
}
