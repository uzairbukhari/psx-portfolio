import { type Portfolio } from '@/lib/portfolio';
import { parsePypsxMessage } from '@/lib/pypsx-market';
import { pypsxCredentialsFor } from '@/lib/pypsx-server';
import { db, failure, identity } from '@/lib/server';

const encoder = new TextEncoder();
const sse = (event: string, value: unknown) =>
  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);

export async function GET(req: Request) {
  try {
    const user = await identity(req);
    const credentials = pypsxCredentialsFor(user);
    if (!credentials) throw Error('The pyPSX live feed is not configured for this account.');
    const row = await db()
      .prepare('SELECT payload FROM portfolios WHERE user_id=?')
      .bind(user)
      .first<{ payload: string }>();
    const portfolio = row ? (JSON.parse(row.payload) as Portfolio) : null;
    const shortlist = portfolio?.monthlyPicksShortlist?.length
      ? portfolio.monthlyPicksShortlist
      : (portfolio?.companies ?? [])
          .filter((company) => company.target > 0)
          .map((company) => company.ticker);
    const allowed = new Set(shortlist);
    if (!allowed.size) throw Error('Choose at least one company in Monthly Picks.');

    const upstreamResponse = await fetch('https://paper-api.pypsx.com/ws/market', {
      headers: {
        Upgrade: 'websocket',
        'PYPSX-API-KEY-ID': credentials.keyId,
        'PYPSX-API-SECRET-KEY': credentials.secretKey,
      },
    });
    const upstream = upstreamResponse.webSocket;
    if (!upstream || upstreamResponse.status !== 101)
      throw Error(`pyPSX live feed rejected the connection (${upstreamResponse.status}).`);
    upstream.accept();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          clearInterval(keepAlive);
          try {
            controller.close();
          } catch {}
        };
        const write = (event: string, value: unknown) => {
          if (!finished) controller.enqueue(sse(event, value));
        };
        const keepAlive = setInterval(() => {
          if (!finished) controller.enqueue(encoder.encode(': keep-alive\n\n'));
        }, 15_000);
        write('status', { connected: true, provider: 'pyPSX' });
        upstream.addEventListener('message', (event) => {
          if (typeof event.data !== 'string') return;
          try {
            const parsed = parsePypsxMessage(event.data, allowed);
            if ('pongTimestamp' in parsed)
              upstream.send(JSON.stringify({ type: 'pong', timestamp: parsed.pongTimestamp }));
            for (const update of parsed.updates) write('quote', update);
          } catch {
            // Ignore malformed provider messages and keep the last verified quote.
          }
        });
        upstream.addEventListener('close', finish);
        upstream.addEventListener('error', () => {
          write('status', { connected: false, provider: 'pyPSX' });
          finish();
        });
        req.signal.addEventListener('abort', () => {
          try {
            upstream.close(1000, 'Dashboard hidden or closed');
          } catch {}
          finish();
        });
      },
      cancel() {
        try {
          upstream.close(1000, 'Client disconnected');
        } catch {}
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    return failure(error);
  }
}
