// Keeps the last portfolio payload on disk so the app opens instantly and works offline.
// The payload can be megabytes, far beyond SecureStore's limit, so it goes in the cache dir.
import { InteractionManager } from 'react-native';
import { File, Paths } from 'expo-file-system';
import type { PortfolioResponse } from '@shared/api-types.ts';
import { createDeferredWriter } from './deferred-writer';

const fileFor = (email: string) =>
  new File(Paths.cache, `portfolio-${email.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.json`);

export async function readPortfolioCache(email: string): Promise<PortfolioResponse | null> {
  try {
    const file = fileFor(email);
    if (!file.exists) return null;
    const data = JSON.parse(await file.text()) as PortfolioResponse;
    return data?.portfolio && Array.isArray(data.portfolio.companies) ? data : null;
  } catch {
    return null;
  }
}

// Serialising and writing a multi-megabyte payload would stall taps, so it runs after interactions settle,
// and a burst of saves writes only the newest version.
const enqueueWrite = createDeferredWriter<PortfolioResponse>(
  (run) => void InteractionManager.runAfterInteractions(run),
  (email, data) => fileFor(email).write(JSON.stringify(data)),
);

export function writePortfolioCache(email: string, data: PortfolioResponse): void {
  enqueueWrite(email, data);
}

export function clearPortfolioCache(email: string): void {
  enqueueWrite.cancel(email);
  try {
    const file = fileFor(email);
    if (file.exists) file.delete();
  } catch {
    // ignore
  }
}
