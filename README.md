# Cloudflare Worker Webhook Logger

A minimal Cloudflare Worker that accepts incoming webhooks, stores recent payloads in a Durable Object, and exposes a lightweight HTML viewer served from static assets.

## Endpoints
- `POST /webhook` — accepts any payload, stores a capped rolling log (latest 200).
- `GET /logs` — returns stored logs as JSON.
- `DELETE /logs` — clears stored logs.
- `/` or `/view` — serves the HTML log viewer.

## Quick start
1. Install dependencies: `npm install`
2. Start locally: `npm run dev`
3. In another terminal, send a test payload:
   ```bash
   curl -X POST http://127.0.0.1:8787/webhook \
     -H "Content-Type: application/json" \
     -d '{"event":"hello","source":"local"}'
   ```
4. Open http://127.0.0.1:8787/ to see the log viewer update.

## Deploy
- Deploy to Cloudflare: `npm run deploy`
- Deployed domain: https://my-hook.dajneem23.workers.dev
- `wrangler.toml` already binds the Durable Object `LOG_STORE` and the static asset bucket `ASSETS` (public/viewer.html).

## Notes
- Logs are capped to the most recent 200 entries to keep the Durable Object light.
- Stored headers are limited to a few helpful fields (content-type, user-agent, cf-connecting-ip, x-forwarded-for).
- The viewer polls `/logs` every few seconds and also supports manual refresh and clearing logs.
- Copy button in the viewer uses the deployed domain: https://my-hook.dajneem23.workers.dev
- The viewer also provides a Node.js fetch snippet that targets the deployed domain.

## Node fetch example (local or deployed)
```ts
import fetch from 'node-fetch';

async function main() {
  const res = await fetch('https://my-hook.dajneem23.workers.dev/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'hello', source: 'node' }),
  });

  const data = await res.json();
  console.log(data);
}

main().catch(console.error);
```

## Scripts
- `npm run dev` — run the worker locally with Wrangler.
- `npm run deploy` — publish the worker.
- `npm run check` — type-check with TypeScript.
