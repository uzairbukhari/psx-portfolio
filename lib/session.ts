const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export type SessionUser = { email: string; name: string | null };

export async function signSession(
  email: string,
  name: string | null,
  secret: string,
  ttlMs = 30 * 24 * 60 * 60 * 1000,
): Promise<string> {
  const payload = Buffer.from(
    JSON.stringify({ email, name, exp: Date.now() + ttlMs }),
  ).toString('base64url');
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return `${payload}.${Buffer.from(signature).toString('base64url')}`;
}

export async function verifySession(
  token: string,
  secret: string,
): Promise<SessionUser | null> {
  try {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;
    const key = await hmacKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      Buffer.from(signature, 'base64url'),
      encoder.encode(payload),
    );
    if (!valid) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      email?: string;
      name?: string | null;
      exp?: number;
    };
    if (!data.email || typeof data.exp !== 'number' || data.exp < Date.now())
      return null;
    return { email: data.email, name: data.name ?? null };
  } catch {
    return null;
  }
}

export function serializeCookie(
  name: string,
  value: string,
  { maxAge }: { maxAge: number },
): string {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function serializeExpiredCookie(name: string): string {
  return `${name}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function readCookieValue(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}
