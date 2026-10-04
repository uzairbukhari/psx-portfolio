// Reads a web page or PDF as plain text for the research job (GitHub Actions runner, never the Worker). Used for
// financial-results PDFs and to check the quotes a report cites. Only public https pages are fetched.
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_CHARS = 200_000;

export function publicHttpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || /^[\d.]+$/.test(host) || host.includes(':')) return null;
    return url;
  } catch { return null; }
}

// Decoded in a single pass so '&amp;lt;' becomes the text '&lt;', never '<'.
const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', quot: '"', apos: "'", '#39': "'", '#039': "'", lt: '<', gt: '>' };

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(nbsp|amp|quot|apos|lt|gt|#0?39);/g, (_, name: string) => ENTITIES[name] ?? ' ')
    .replace(/\s+/g, ' ').trim();
}

export async function pdfToText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes, useWorkerFetch: false, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  const parts: string[] = [];
  for (let page = 1; page <= Math.min(doc.numPages, 40); page++) {
    const content = await (await doc.getPage(page)).getTextContent();
    parts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
    if (parts.join(' ').length > MAX_CHARS) break;
  }
  await task.destroy();
  return parts.join('\n').replace(/[ \t]+/g, ' ').trim();
}

export async function fetchPageText(value: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const url = publicHttpsUrl(value);
  if (!url) return null;
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; sipwise-research/1.0)', Accept: 'text/html,application/pdf,text/plain' },
    redirect: 'follow', signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return null;
  // A redirect must not lead somewhere non-public.
  if (response.url && !publicHttpsUrl(response.url)) return null;
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) return null;
  const type = response.headers.get('content-type') ?? '';
  const text = type.includes('pdf') || url.pathname.toLowerCase().endsWith('.pdf')
    ? await pdfToText(buffer)
    : htmlToText(new TextDecoder().decode(buffer));
  return text.slice(0, MAX_CHARS);
}
