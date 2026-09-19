// The in-browser research runner: replaces the old Mac helper CLI. While a
// Research desk tab is open, it claims the signed-in user's queued jobs and
// processes them (discover PSX/issuer pages, download report PDFs, extract
// text, run external credibility search, request AI synthesis) using the
// server's /api/research/proxy route for anything that needs a server-side
// fetch (CORS), and pdfjs-dist for text extraction. Progress is written to
// the same research_jobs/research_events rows the old helper wrote to, so
// the existing job list/detail UI keeps working unchanged.
import { hasPdfSignature, credibleResearchHost } from '@/lib/research-policy.mjs';
import { selectEvidence } from '@/lib/research-evidence.mjs';
import { extractPdfText } from './research-pdf';

export type RunnerDocument = {
  title: string;
  url: string;
  kind: string;
  date: string;
  bytes?: Uint8Array;
  text?: string;
  status: 'downloaded_pdf_validated' | 'download_failed';
  error?: string;
};

type RunnerEvent = {
  jobId: string;
  stage: string;
  message: string;
  reportsFound: number;
};

const runnerId =
  (typeof crypto !== 'undefined' && crypto.randomUUID?.()) ||
  Math.random().toString(36).slice(2);

const listeners = new Set<(event: RunnerEvent) => void>();
export function onRunnerEvent(listener: (event: RunnerEvent) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function emit(event: RunnerEvent) {
  for (const listener of listeners) listener(event);
}

// Kept in memory for the life of the tab so a finished job's "download
// sources" button can zip what this run actually fetched. Not persisted —
// closing the tab drops it, same as the old local companies/<TICKER> folder
// would simply not exist until the next successful run.
const runArchive = new Map<
  string,
  { ticker: string; documents: RunnerDocument[]; dossierMarkdown: string }
>();
export function getRunArchive(jobId: string) {
  return runArchive.get(jobId);
}

// The job's server-side checkpoint deliberately drops extracted text/bytes
// (keeping the DB row small), so a resumed job that failed at synthesis —
// not at download — has no way to know discover()/downloadReports() were
// already done. Without this, clicking Resume re-fetches and re-extracts
// every report from scratch. Caching per job id in this tab means a same-
// tab retry skips straight back to evidence + synthesis; a resume claimed
// by a different tab (or after a reload) just falls back to a full re-run.
const downloadCache = new Map<
  string,
  { found: Awaited<ReturnType<typeof discover>>; documents: RunnerDocument[] }
>();

async function call(path: string, body: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(240_000),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok)
    throw Error((data.error as string) || `Research service returned ${response.status}.`);
  if (data.cancelled || data.cancelRequested) throw Error('Research cancelled.');
  return data;
}

async function proxyFetch(url: string, mode: 'report' | 'search') {
  const response = await fetch('/api/research/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, mode }),
    signal: AbortSignal.timeout(35_000),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw Error(data.error || `${url} could not be fetched.`);
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  return {
    bytes: buffer,
    finalUrl: response.headers.get('X-Proxy-Final-Url') || url,
    contentType: response.headers.get('X-Proxy-Content-Type') || '',
  };
}
async function fetchText(url: string, mode: 'report' | 'search' = 'report') {
  const { bytes, finalUrl } = await proxyFetch(url, mode);
  return { text: new TextDecoder().decode(bytes), finalUrl };
}

function absolute(href: string, from: string) {
  try {
    return new URL(href, from).href;
  } catch {
    return null;
  }
}
function links(html: string, from: string) {
  return [...html.matchAll(/href=["']([^"'#]+)["']/gi)]
    .map((match) => absolute(match[1], from))
    .filter((value): value is string => !!value);
}
function cleanHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function safeName(value: string) {
  return (
    value
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100) || 'document'
  );
}

async function externalResearch(query: string) {
  const searchUrl = 'https://www.bing.com/search?format=rss&q=' + encodeURIComponent(query);
  try {
    const result = await fetchText(searchUrl, 'search');
    const urls = [...result.text.matchAll(/<link>(https?:[^<]+)<\/link>/gi)]
      .map((match) => match[1].replace(/&amp;/g, '&'))
      .filter((url) => {
        try {
          return credibleResearchHost(new URL(url).host);
        } catch {
          return false;
        }
      })
      .slice(0, 8);
    const sources: { title: string; url: string; text: string }[] = [];
    for (const url of urls) {
      try {
        const page = await fetchText(url, 'search');
        const text = cleanHtml(page.text).slice(0, 45_000);
        if (text.length >= 500)
          sources.push({
            title: page.text.match(/<title[^>]*>([^<]+)/i)?.[1]?.trim() || new URL(page.finalUrl).host,
            url: page.finalUrl,
            text,
          });
      } catch {
        // best-effort external research; a single unreachable source is skipped
      }
    }
    return sources;
  } catch {
    return [];
  }
}

type JobInput = {
  id: string;
  ticker: string;
  companyName: string;
  sector: string;
  checkpoint?: Record<string, unknown> | null;
};

async function discover(job: JobInput) {
  const psxUrl = `https://dps.psx.com.pk/company/${job.ticker}`;
  const page = await fetchText(psxUrl);
  if (/page not found|company not found/i.test(page.text))
    throw Error(`PSX ticker ${job.ticker} was not found.`);
  const rawTitle = page.text.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
  const title =
    rawTitle?.match(/Stock quote for (.+?)\s*-\s*Pakistan Stock Exchange/i)?.[1]?.trim() ||
    rawTitle?.replace(/\s*[|–-]\s*Pakistan Stock Exchange.*$/i, '').trim();
  const heading = page.text.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').trim();
  const companyName = title || heading || job.companyName;
  const cleanPage = cleanHtml(page.text);
  const escapedCompanyName = String(companyName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sector =
    cleanPage.match(new RegExp(`${escapedCompanyName}\\s+([A-Z][A-Z &/()-]{3,80})\\s+Rs\\.`, 'i'))?.[1]?.trim() ||
    job.sector;
  const psxHost = new URL(psxUrl).host;
  const websiteBlock = page.text.match(
    /item__head["'][^>]*>WEBSITE<\/div>[\s\S]{0,500}?href=["']([^"']+)["']/i,
  );
  const companyWebsite = websiteBlock ? absolute(websiteBlock[1], psxUrl) : null;
  const price = Number(
    page.text.match(/quote__close["'][^>]*>Rs\.\s*([0-9,.]+)/i)?.[1]?.replace(/,/g, ''),
  );
  const marketPe = Number(
    page.text
      .match(/P\/E Ratio \(TTM\)[\s\S]{0,180}?stats_value["'][^>]*>([0-9,.]+)/i)?.[1]
      ?.replace(/,/g, ''),
  );
  const financialPanel =
    page.text.match(
      /<div class=["']tabs__panel["'] data-name=["']Financial Results["']>[\s\S]*?(?=<div class=["']tabs__panel["']|<\/section>)/i,
    )?.[0] || '';
  const directPdfs = links(financialPanel, psxUrl).filter(
    (url) => /\.pdf(?:$|\?)/i.test(url) || /\/download\/document\//i.test(url),
  );
  let annualPdfs: string[] = [];
  try {
    const reportArchive = await fetchText(`https://dps.psx.com.pk/company/reports/${job.ticker}`);
    annualPdfs = [...reportArchive.text.matchAll(/<tr>[\s\S]*?<\/tr>/gi)]
      .map((match) => match[0])
      .filter((row) => /<td>\s*<a[^>]*>Annual<\/a>/i.test(row))
      .flatMap((row) => links(row, reportArchive.finalUrl))
      .reverse()
      .slice(0, 5)
      .map((url) => {
        const id = new URL(url).searchParams.get('id');
        return /^\d+$/.test(id || '') ? `https://dps.psx.com.pk/download/document/${id}.pdf` : url;
      });
  } catch {
    // no annual-report archive page for this ticker; direct PDFs (if any) still apply
  }
  const pages = companyWebsite
    ? [
        companyWebsite,
        absolute('/investors/financial-reports', companyWebsite),
        absolute('/investors/annual-reports', companyWebsite),
        absolute('/publications', companyWebsite),
      ].filter((value): value is string => !!value)
    : [];
  const allowedHosts = new Set([psxHost]);
  if (companyWebsite) {
    const companyHost = new URL(companyWebsite).host;
    allowedHosts.add(companyHost);
    allowedHosts.add(companyHost.replace(/^www\./, ''));
    allowedHosts.add('www.' + companyHost.replace(/^www\./, ''));
  }
  const discovered = [...annualPdfs, ...directPdfs];
  for (let pageIndex = 0; pageIndex < pages.length && pageIndex < 9; pageIndex++) {
    const url = pages[pageIndex];
    try {
      const found = await fetchText(url);
      for (const link of links(found.text, found.finalUrl)) {
        if (!allowedHosts.has(new URL(link).host)) continue;
        if (/\.pdf(?:$|\?)/i.test(link)) discovered.push(link);
        else if (/annual|financial|investor|report|result/i.test(link)) pages.push(link);
      }
    } catch {
      // an unreachable issuer page just yields fewer candidate links
    }
  }
  const webSources = [
    {
      title: `PSX company page for ${job.ticker}`,
      url: psxUrl,
      text: cleanHtml(page.text).slice(0, 90_000),
    },
    ...(await externalResearch(
      `${companyName} ${job.ticker} Pakistan investment research rating industry outlook`,
    )),
  ];
  const ranked = [...new Set(discovered)].sort((a, b) => {
    const score = (url: string) =>
      (/annual/i.test(url) ? 5 : 0) +
      (/2026|2025|2024/i.test(url) ? 3 : 0) +
      (/quarter|interim|half|result/i.test(url) ? 2 : 0);
    return score(b) - score(a);
  });
  return {
    companyName,
    sector,
    psxUrl,
    market: {
      price: Number.isFinite(price) && price > 0 ? price : null,
      priceDate: new Date().toISOString().slice(0, 10),
      pe: Number.isFinite(marketPe) && marketPe > 0 ? marketPe : null,
    },
    webSources,
    urls: [...new Set(ranked)].slice(0, 12),
  };
}

async function downloadReports(
  job: JobInput,
  found: Awaited<ReturnType<typeof discover>>,
  onDocument: (documents: RunnerDocument[]) => Promise<void>,
) {
  const documents: RunnerDocument[] = [];
  for (let index = 0; index < found.urls.length; index++) {
    const url = found.urls[index];
    let filename = safeName(decodeURIComponent(new URL(url).pathname.split('/').pop() || 'document'));
    if (!filename.toLowerCase().endsWith('.pdf')) filename += '.pdf';
    filename = String(index + 1).padStart(2, '0') + '-' + filename;
    try {
      await onDocument(documents);
      const { bytes } = await proxyFetch(url, 'report');
      if (!hasPdfSignature(bytes)) throw Error('the fetched file was not a PDF');
      const { text } = await extractPdfText(bytes);
      if (text.replace(/\s/g, '').length < 300) throw Error('PDF text is unreadable or image-only');
      documents.push({
        title:
          (text.match(/Annual Report\s+(20\d{2})/i)?.[0] || filename)
            .replace(/^\d+-/, '')
            .replace(/\.pdf$/i, '')
            .replace(/-/g, ' '),
        url,
        kind: /annual/i.test(filename)
          ? 'Annual report'
          : /interim|quarter|half|result/i.test(filename)
            ? 'Interim / results'
            : 'Official filing',
        date: '',
        bytes,
        text,
        status: 'downloaded_pdf_validated',
      });
      await onDocument(documents);
    } catch (error) {
      documents.push({
        title: filename,
        url,
        kind: 'Official filing',
        date: '',
        status: 'download_failed',
        error: error instanceof Error ? error.message : String(error),
      });
      await onDocument(documents);
    }
  }
  return documents;
}

function evidenceFrom(documents: RunnerDocument[], webSources: { title: string; url: string; text: string }[]) {
  const valid = documents.filter((document) => document.status === 'downloaded_pdf_validated');
  // Every annual report carries its own overlapping multi-year summary
  // table; only the newest one's should compete for evidence space (see
  // lib/research-evidence.mjs). "Newest" = highest year named in the title
  // pdf.js's extraction already found (falls back to the first document).
  const primaryIndex = valid.reduce((best, document, index) => {
    const year = Number(document.title.match(/20\d{2}/)?.[0] ?? 0);
    const bestYear = Number(valid[best].title.match(/20\d{2}/)?.[0] ?? 0);
    return year > bestYear ? index : best;
  }, 0);
  return selectEvidence(
    valid.map((document, index) => ({
      ...document,
      text: document.text || '',
      isPrimary: index === primaryIndex,
    })),
    webSources,
  );
}

async function processJob(job: JobInput) {
  const heartbeat = window.setInterval(
    () => void call('/api/research/run', { action: 'heartbeat', runnerId, id: job.id }).catch(() => {}),
    30_000,
  );
  let checkpoint: Record<string, unknown> = job.checkpoint || {};
  const progress = async (stage: string, message: string, reportsFound = 0, nextCheckpoint?: unknown) => {
    emit({ jobId: job.id, stage, message, reportsFound });
    await call('/api/research/run', {
      action: 'progress',
      runnerId,
      id: job.id,
      stage,
      message,
      reportsFound,
      checkpoint: nextCheckpoint,
    });
  };
  try {
    if (checkpoint.dossier && checkpoint.found) {
      const dossier = checkpoint.dossier as { ticker: string; name: string };
      const found = checkpoint.found as { companyName: string; sector: string };
      dossier.ticker = job.ticker;
      dossier.name = found.companyName;
      await call('/api/research/run', {
        action: 'complete',
        runnerId,
        id: job.id,
        dossier,
        companyName: found.companyName,
        sector: found.sector,
      });
      downloadCache.delete(job.id);
      return;
    }
    const cached = downloadCache.get(job.id);
    let found: Awaited<ReturnType<typeof discover>>;
    let documents: RunnerDocument[];
    if (cached) {
      ({ found, documents } = cached);
      const validCount = documents.filter((d) => d.status === 'downloaded_pdf_validated').length;
      checkpoint = { found, documents: documents.map(({ bytes: _bytes, text: _text, ...rest }) => rest) };
      await progress(
        'extracting',
        `Reusing ${validCount} report${validCount === 1 ? '' : 's'} already downloaded this session`,
        validCount,
        checkpoint,
      );
    } else {
      await progress('verifying', `Verifying ${job.ticker} on PSX`, 0, checkpoint);
      found = await discover(job);
      await progress(
        'finding_reports',
        `Found ${found.urls.length} official report candidate${found.urls.length === 1 ? '' : 's'}`,
        0,
        { ...checkpoint, found },
      );
      if (!found.urls.length)
        throw Error(
          'No official report links were found. Add or verify the company investor-relations source, then resume.',
        );
      documents = await downloadReports(job, found, async (partial) => {
        const validCount = partial.filter((d) => d.status === 'downloaded_pdf_validated').length;
        await progress(
          'downloading',
          `Validated ${validCount} official report${validCount === 1 ? '' : 's'}`,
          validCount,
          { found, documents: partial.map(({ bytes: _bytes, text: _text, ...rest }) => rest) },
        );
      });
      checkpoint = { found, documents: documents.map(({ bytes: _bytes, text: _text, ...rest }) => rest) };
      const validAfterDownload = documents.filter((document) => document.status === 'downloaded_pdf_validated');
      if (!validAfterDownload.length)
        throw Error(
          `Official links were found, but none produced a readable PDF. ${documents
            .map((document) => document.error)
            .filter(Boolean)
            .slice(0, 3)
            .join('; ') || 'Partial download records were preserved.'}`,
        );
      downloadCache.set(job.id, { found, documents });
      await progress(
        'extracting',
        `Preparing cited evidence from ${validAfterDownload.length} validated report${validAfterDownload.length === 1 ? '' : 's'}`,
        validAfterDownload.length,
        checkpoint,
      );
    }
    const valid = documents.filter((document) => document.status === 'downloaded_pdf_validated');
    const evidence = evidenceFrom(documents, found.webSources);
    const synthesis = (await call('/api/research/synthesize', {
      id: job.id,
      runnerId,
      ticker: job.ticker,
      companyName: found.companyName,
      market: found.market,
      evidence,
      documents: valid
        .map(({ title, url, kind, date }) => ({ title, url, kind, date }))
        .concat(
          found.webSources.map((source) => ({
            title: source.title,
            url: source.url,
            kind: 'Web research',
            date: found.market.priceDate,
          })),
        ),
    })) as { dossier: Record<string, unknown> };
    synthesis.dossier.ticker = job.ticker;
    synthesis.dossier.name = found.companyName;
    checkpoint = { ...checkpoint, dossier: synthesis.dossier };
    await progress('validating', 'Validating citations, score limits and dossier structure', valid.length, checkpoint);
    const thesis = typeof synthesis.dossier.thesis === 'string' ? synthesis.dossier.thesis : '';
    runArchive.set(job.id, {
      ticker: job.ticker,
      documents: valid,
      dossierMarkdown: `# ${job.ticker} — ${found.companyName}\n\n${thesis}\n`,
    });
    await progress('saving', 'Dossier validated; saving to your portfolio', valid.length, checkpoint);
    await call('/api/research/run', {
      action: 'complete',
      runnerId,
      id: job.id,
      dossier: synthesis.dossier,
      companyName: found.companyName,
      sector: found.sector,
    });
    downloadCache.delete(job.id);
  } catch (error) {
    try {
      await call('/api/research/run', {
        action: 'attention',
        runnerId,
        id: job.id,
        error: error instanceof Error ? error.message : String(error),
        checkpoint,
      });
    } catch {
      // the job stays leased; it will be reclaimed once the lease expires
    }
  } finally {
    window.clearInterval(heartbeat);
  }
}

let loopHandle = 0;
let loopRunning = false;

async function tick() {
  if (loopRunning) return;
  loopRunning = true;
  try {
    const data = (await call('/api/research/run', { action: 'claim', runnerId })) as {
      job: JobInput | null;
    };
    if (data.job) await processJob(data.job);
  } catch {
    // transient network/claim errors are retried on the next tick
  } finally {
    loopRunning = false;
  }
}

export function startResearchRunner() {
  if (loopHandle) return () => {};
  void tick();
  loopHandle = window.setInterval(() => void tick(), 15_000);
  return () => {
    window.clearInterval(loopHandle);
    loopHandle = 0;
  };
}
