// The app talks to one API. Ciphertext and key wrappers are safe against a passive reader, but tokens, tickers
// and metadata are not, and an http:// deployment could also be tampered with, so a deployed build must use
// https. Plain http is allowed only for the development variant against loopback / emulator hosts.
const LOOPBACK = /^(localhost|127\.0\.0\.1|10\.0\.2\.2|\[::1\])$/;

export function assertSecureApiUrl(url: string, variant: string): string {
  if (!url) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`The API address "${url}" is not a valid URL.`);
  }
  if (parsed.protocol === 'https:') return url;
  if (parsed.protocol === 'http:' && variant === 'development' && LOOPBACK.test(parsed.hostname)) return url;
  throw new Error('This build is configured with an insecure API address. Deployed builds must use https.');
}
