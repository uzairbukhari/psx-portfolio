// Verifies a Google ID token (RS256 JWT) obtained by the native Google Sign-In
// SDK: signature against Google's published keys, issuer, audience, expiry and
// verified email. Pure and fetch-injectable so it can be unit tested.
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

export type GoogleIdentity = {
  email: string;
  name: string | null;
  picture: string | null;
};

type Jwk = { kid?: string; kty?: string; alg?: string; n?: string; e?: string };

const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

let cachedKeys: { keys: Jwk[]; expires: number } | null = null;

async function loadKeys(fetcher: typeof fetch, now: number): Promise<Jwk[]> {
  if (cachedKeys && cachedKeys.expires > now) return cachedKeys.keys;
  const response = await fetcher(GOOGLE_JWKS_URL);
  if (!response.ok) throw new Error('Could not load Google signing keys.');
  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  cachedKeys = { keys, expires: now + 60 * 60 * 1000 };
  return keys;
}

export function resetGoogleKeyCache() {
  cachedKeys = null;
}

function decodeSegment<T>(segment: string): T {
  return JSON.parse(Buffer.from(segment, 'base64url').toString()) as T;
}

/** Returns the verified identity, or null for any invalid token. */
export async function verifyGoogleIdToken(
  idToken: string,
  audiences: string[],
  { fetcher = fetch, now = Date.now() }: { fetcher?: typeof fetch; now?: number } = {},
): Promise<GoogleIdentity | null> {
  try {
    if (!audiences.length) return null;
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;
    const [headerSegment, payloadSegment, signatureSegment] = parts;
    const header = decodeSegment<{ alg?: string; kid?: string }>(headerSegment);
    if (header.alg !== 'RS256' || !header.kid) return null;

    let keys = await loadKeys(fetcher, now);
    let jwk = keys.find((key) => key.kid === header.kid);
    if (!jwk) {
      // Google rotates keys; refetch once before giving up on an unknown kid.
      resetGoogleKeyCache();
      keys = await loadKeys(fetcher, now);
      jwk = keys.find((key) => key.kid === header.kid);
    }
    if (!jwk || jwk.kty !== 'RSA') return null;

    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      Buffer.from(signatureSegment, 'base64url'),
      new TextEncoder().encode(`${headerSegment}.${payloadSegment}`),
    );
    if (!valid) return null;

    const claims = decodeSegment<{
      iss?: string;
      aud?: string;
      exp?: number;
      email?: string;
      email_verified?: boolean | string;
      name?: string;
      picture?: string;
    }>(payloadSegment);
    if (!claims.iss || !GOOGLE_ISSUERS.has(claims.iss)) return null;
    if (!claims.aud || !audiences.includes(claims.aud)) return null;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 < now) return null;
    const verified = claims.email_verified === true || claims.email_verified === 'true';
    if (!verified || !claims.email) return null;
    return {
      email: claims.email.toLowerCase(),
      name: typeof claims.name === 'string' ? claims.name : null,
      picture: safeGooglePicture(claims.picture),
    };
  } catch {
    return null;
  }
}

export function safeGooglePicture(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith('.googleusercontent.com')
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function parseList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Empty allow-list means open to any verified Google account. */
export function emailAllowed(email: string, allowedEmails: string | undefined): boolean {
  const allowed = parseList(allowedEmails).map((entry) => entry.toLowerCase());
  return !allowed.length || allowed.includes(email.toLowerCase());
}
