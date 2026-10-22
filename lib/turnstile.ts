// Cloudflare Turnstile check for the signed-out feedback form. Fails closed: with no secret configured, signed-out
// submissions are refused (the signed-in form does not need it).
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(
  secret: string | undefined,
  token: unknown,
  ip: string | null,
  doFetch: typeof fetch = fetch,
): Promise<boolean> {
  if (!secret || typeof token !== 'string' || !token || token.length > 2048)
    return false;
  const form = new FormData();
  form.set('secret', secret);
  form.set('response', token);
  if (ip) form.set('remoteip', ip);
  try {
    const res = await doFetch(VERIFY_URL, { method: 'POST', body: form });
    if (!res.ok) return false;
    return ((await res.json()) as { success?: boolean }).success === true;
  } catch {
    return false;
  }
}
