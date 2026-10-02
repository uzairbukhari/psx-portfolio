import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { fetch as streamFetch } from 'expo/fetch';
import { tokenStore } from '@/auth/token-store';
import { config } from '@/config';
import { emptyLive, MAX_STREAM_RETRIES, readLiveStream, reduceLive, retryDelayMs, StreamRejected, type LiveState } from './live-market';

export type LiveStatus = 'off' | 'connecting' | 'live' | 'fallback';

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * Reads /api/market-stream with expo/fetch while `enabled` (the caller says: screen focused, PSX open, feed available)
 * and the app is in the foreground. Reconnects up to three times with backoff; a 4xx (feed not set up for this
 * account) or exhausted retries leave status `fallback`, and the caller's polling carries on as before.
 */
export function useLiveMarket(enabled: boolean): { live: LiveState; status: LiveStatus } {
  const [live, setLive] = useState<LiveState>(emptyLive);
  const [status, setStatus] = useState<LiveStatus>('off');
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!enabled || !appActive) {
      setLive(emptyLive);
      setStatus('off');
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      let attempt = 0;
      while (!signal.aborted) {
        setStatus('connecting');
        try {
          await readLiveStream({
            fetcher: streamFetch as unknown as Parameters<typeof readLiveStream>[0]['fetcher'],
            url: `${config.apiBaseUrl}/api/market-stream`,
            token: await tokenStore.get(),
            signal,
            onEvent: (event) => {
              attempt = 0;
              setLive((state) => reduceLive(state, event));
              setStatus('live');
            },
          });
        } catch (e) {
          if (signal.aborted) return;
          // The account has no live feed, or the session was rejected: do not hammer the server.
          if (e instanceof StreamRejected && e.status >= 400 && e.status < 500) {
            setStatus('fallback');
            return;
          }
        }
        if (signal.aborted) return;
        setLive((state) => ({ ...state, connected: false }));
        if (attempt >= MAX_STREAM_RETRIES) {
          setStatus('fallback');
          return;
        }
        await sleep(retryDelayMs(attempt++), signal);
      }
    })();
    return () => controller.abort();
  }, [enabled, appActive]);

  return { live, status };
}
