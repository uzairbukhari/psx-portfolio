// Extracts page-marked text from a PDF entirely in the browser, replacing
// the old Mac helper's pdftotext/pdfinfo (poppler) subprocess calls.
//
// pdfjs-dist touches `window` at module load time, which breaks vinext's
// SSR pass of this client component's module graph (Workers/Node has no
// `window`). Importing it lazily, only when extraction actually runs
// (browser-only, never during SSR render), avoids that entirely.
//
// The worker itself is constructed via the `new Worker(new URL(...,
// import.meta.url), { type: 'module' })` form (not `?url` +
// GlobalWorkerOptions.workerSrc): in dev mode Vite injects its own HMR
// client into a plain `?url`-loaded worker's module graph, and that HMR
// client references `window`, which doesn't exist inside a real Worker's
// global scope — throwing "window is not defined" the moment pdf.js spins
// the worker up. The `new URL(..., import.meta.url)` form is the one Vite
// statically detects as a worker entry, so it excludes its client script
// and preserves the worker file's own ESM format.
let pdfjsLibPromise: ReturnType<typeof loadPdfjs> | null = null;
async function loadPdfjs() {
  const pdfjsLib = await import('pdfjs-dist');
  // In the built app, `import.meta.url` here has been observed to resolve
  // to a `file:///...` base rather than the page's real origin (the
  // hashed asset path itself is correct — only the base is wrong), which
  // a Worker constructor refuses cross-origin. Since this only ever runs
  // client-side, rebuild it from window.location.origin when that happens.
  let workerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url);
  if (workerUrl.protocol !== 'http:' && workerUrl.protocol !== 'https:')
    workerUrl = new URL(workerUrl.pathname, window.location.origin);
  const worker = new Worker(workerUrl, { type: 'module' });
  pdfjsLib.GlobalWorkerOptions.workerPort = worker;
  return pdfjsLib;
}

export async function extractPdfText(
  bytes: Uint8Array,
): Promise<{ text: string; pages: number }> {
  pdfjsLibPromise ??= loadPdfjs();
  const pdfjsLib = await pdfjsLibPromise;
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const doc = await loadingTask.promise;
  const pages = doc.numPages;
  const marked: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const text = content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ');
        marked.push(`\n--- PDF PAGE ${pageNumber} ---\n${text.trim()}\n`);
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await loadingTask.destroy();
  }
  return { text: marked.join(''), pages };
}
