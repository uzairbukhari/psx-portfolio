// Plain text of a downloaded document for the scrapers: PDF text through pdf.js (the same extraction and
// reading-order reconstruction the app uses), HTML with tags stripped. Needs `npm ci` for pdfjs-dist.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const MAX_BYTES = 25_000_000;

export async function documentText(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw Error('document too large');
  const isPdf = String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-';
  if (!isPdf) return new TextDecoder().decode(bytes).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  const require = createRequire(import.meta.url);
  const root = require.resolve('pdfjs-dist/package.json').replace(/package\.json$/, '');
  const pdfjs = await import(pathToFileURL(root + 'legacy/build/pdf.mjs').href);
  const { extractMarkedText } = await import('../lib/pdf-layout.mjs');
  const loading = pdfjs.getDocument({ data: bytes, verbosity: 0 });
  const doc = await loading.promise;
  try {
    return await extractMarkedText(doc);
  } finally {
    await loading.destroy();
  }
}
