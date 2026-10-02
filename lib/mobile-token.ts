// App (bearer) tokens for the native apps. Signed with the same secret as the
// web session cookie but carry `aud: "mobile"` and a device-session id, so one
// can never be replayed as the other, and a device can be revoked server-side.
const encoder = new TextEncoder();

export const MOBILE_AUDIENCE = 'mobile';
export const MOBILE_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export type MobileTokenUser = {
  email: string;
  name: string | null;
  picture: string | null;
  sid: string;
};

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signMobileToken(
  user: MobileTokenUser,
  secret: string,
  ttlMs = MOBILE_TOKEN_TTL_MS,
): Promise<string> {
  const payload = Buffer.from(
    JSON.stringify({
      email: user.email,
      name: user.name,
      picture: user.picture,
      sid: user.sid,
      aud: MOBILE_AUDIENCE,
      exp: Date.now() + ttlMs,
    }),
  ).toString('base64url');
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return `${payload}.${Buffer.from(signature).toString('base64url')}`;
}

export async function verifyMobileToken(
  token: string,
  secret: string,
): Promise<MobileTokenUser | null> {
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
      picture?: string | null;
      sid?: string;
      aud?: string;
      exp?: number;
    };
    if (data.aud !== MOBILE_AUDIENCE) return null;
    if (!data.email || !data.sid || typeof data.exp !== 'number' || data.exp < Date.now())
      return null;
    return {
      email: data.email,
      name: data.name ?? null,
      picture: typeof data.picture === 'string' ? data.picture : null,
      sid: data.sid,
    };
  } catch {
    return null;
  }
}

export function readBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match ? match[1] : null;
}
