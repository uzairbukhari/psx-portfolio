// Keeps the last portfolio payload on disk so the app opens instantly and works offline.
// The payload can be megabytes, far beyond SecureStore's limit, so it goes in the cache dir.
import { File, Paths } from 'expo-file-system';
import type { PortfolioResponse } from '@shared/api-types.ts';

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

export function writePortfolioCache(email: string, data: PortfolioResponse): void {
  try {
    fileFor(email).write(JSON.stringify(data));
  } catch {
    // Cache is best effort.
  }
}

export function clearPortfolioCache(email: string): void {
  try {
    const file = fileFor(email);
    if (file.exists) file.delete();
  } catch {
    // ignore
  }
}
