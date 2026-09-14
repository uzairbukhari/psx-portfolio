#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { hasPdfSignature } from '../lib/research-policy.mjs';

const configPath =
  process.env.PSX_RESEARCH_HELPER_CONFIG ||
  join(homedir(), '.psx-research-helper', 'config.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const baseUrl = String(config.baseUrl).replace(/\/$/, '');
const companiesRoot = resolve(String(config.companiesRoot));
const headers = {
  Authorization: `Bearer ${config.token}`,
  ...(config.sitesBypassToken
    ? { 'OAI-Sites-Authorization': `Bearer ${config.sitesBypassToken}` }
    : {}),
  'Content-Type': 'application/json',
};
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

function safeName(value) {
  return (
    value
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100) || 'document'
  );
}
function atomic(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + '.tmp';
  writeFileSync(temporary, contents);
  renameSync(temporary, path);
}
function absolute(href, from) {
  try {
    return new URL(href, from).href;
  } catch {
    return null;
  }
}
function links(html, from) {
  return [...html.matchAll(/href=["']([^"'#]+)["']/gi)]
    .map((match) => absolute(match[1], from))
    .filter(Boolean);
}
function cleanHtml(value) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
async function request(path, options = {}) {
  const response = await fetch(baseUrl + path, {
    ...options,
    headers: { ...headers, ...options.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Error(body.error || `Research service returned ${response.status}.`);
  return body;
}
async function progress(job, stage, message, reportsFound = 0, checkpoint) {
  return request('/api/research/helper', {
    method: 'POST',
    body: JSON.stringify({
      id: job.id,
      action: 'progress',
      stage,
      message,
      reportsFound,
      checkpoint,
    }),
  });
}
async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 PSX Research Helper/1.0' },
    redirect: 'follow',
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw Error(`${response.status} from ${url}`);
  return {
    text: await response.text(),
    finalUrl: response.url,
    type: response.headers.get('content-type') || '',
  };
}

async function discover(job) {
  const psxUrl = `https://dps.psx.com.pk/company/${job.ticker}`;
  const page = await fetchText(psxUrl);
  if (/page not found|company not found/i.test(page.text))
    throw Error(`PSX ticker ${job.ticker} was not found.`);
  const rawTitle = page.text
    .match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]
    ?.trim();
  const title =
    rawTitle
      ?.match(/Stock quote for (.+?)\s*-\s*Pakistan Stock Exchange/i)?.[1]
      ?.trim() ||
    rawTitle?.replace(/\s*[|–-]\s*Pakistan Stock Exchange.*$/i, '').trim();
  const heading = page.text
    .match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]
    ?.replace(/<[^>]+>/g, '')
    .trim();
  const companyName = heading || title || job.companyName;
  const sector =
    cleanHtml(page.text.match(/Sector[\s\S]{0,350}/i)?.[0] || '')
      .replace(/^Sector\s*/i, '')
      .slice(0, 100) || job.sector;
  const firstLinks = [...new Set(links(page.text, psxUrl))];
  const psxHost = new URL(psxUrl).host;
  const excluded =
    /facebook|twitter|linkedin|youtube|instagram|mailto:|javascript:/i;
  const companyCandidates = firstLinks.filter((url) => {
    const host = new URL(url).host;
    return (
      host !== psxHost &&
      !excluded.test(url) &&
      !/google|cloudflare/i.test(host)
    );
  });
  const directPdfs = firstLinks.filter(
    (url) => /\.pdf(?:$|\?)/i.test(url) || /\/download\/document\//i.test(url),
  );
  const pages = firstLinks
    .filter((url) => /annual|financial|investor|report|result/i.test(url))
    .slice(0, 8);
  if (companyCandidates[0]) pages.push(companyCandidates[0]);
  const allowedHosts = new Set([
    psxHost,
    ...companyCandidates.slice(0, 3).map((url) => new URL(url).host),
  ]);
  const discovered = [...directPdfs];
  for (const url of [...new Set(pages)].slice(0, 9)) {
    try {
      const found = await fetchText(url);
      for (const link of links(found.text, found.finalUrl)) {
        if (
          allowedHosts.has(new URL(link).host) &&
          (/\.pdf(?:$|\?)/i.test(link) || /\/download\/document\//i.test(link))
        )
          discovered.push(link);
      }
    } catch {}
  }
  const ranked = [...new Set(discovered)].sort((a, b) => {
    const score = (url) =>
      (/annual/i.test(url) ? 5 : 0) +
      (/2026|2025|2024/i.test(url) ? 3 : 0) +
      (/quarter|interim|half|result/i.test(url) ? 2 : 0);
    return score(b) - score(a);
  });
  const priorManifest = join(companiesRoot, job.ticker, 'sources.json');
  if (existsSync(priorManifest)) {
    try {
      const prior = JSON.parse(readFileSync(priorManifest, 'utf8'));
      for (const document of prior.documents || [])
        if (/^https?:\/\//.test(document.url || '')) ranked.push(document.url);
    } catch {}
  }
  return {
    companyName,
    sector,
    psxUrl,
    urls: [...new Set(ranked)].slice(0, 12),
  };
}

async function downloadReports(job, found) {
  const root = join(companiesRoot, job.ticker);
  const reports = join(root, 'reports');
  const extracted = join(root, 'extracted');
  mkdirSync(reports, { recursive: true });
  mkdirSync(extracted, { recursive: true });
  const documents = [];
  for (let index = 0; index < found.urls.length; index++) {
    const url = found.urls[index];
    let filename = safeName(
      decodeURIComponent(basename(new URL(url).pathname)),
    );
    if (!filename.toLowerCase().endsWith('.pdf')) filename += '.pdf';
    filename = String(index + 1).padStart(2, '0') + '-' + filename;
    const pdfPath = join(reports, filename);
    const textPath = join(extracted, filename.replace(/\.pdf$/i, '.txt'));
    try {
      let bytes;
      if (existsSync(pdfPath)) bytes = readFileSync(pdfPath);
      else {
        const response = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 PSX Research Helper/1.0' },
          redirect: 'follow',
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        bytes = Buffer.from(await response.arrayBuffer());
        if (!hasPdfSignature(bytes)) throw Error('download was not a PDF');
        atomic(pdfPath, bytes);
      }
      if (!hasPdfSignature(bytes)) throw Error('saved file is not a PDF');
      if (!existsSync(textPath)) {
        const raw = execFileSync('pdftotext', ['-layout', pdfPath, '-'], {
          maxBuffer: 80 * 1024 * 1024,
        }).toString();
        const marked = raw
          .split('\f')
          .map(
            (page, pageIndex) =>
              `\n--- PDF PAGE ${pageIndex + 1} ---\n${page.trim()}\n`,
          )
          .join('');
        atomic(textPath, marked);
      }
      const text = readFileSync(textPath, 'utf8');
      if (text.replace(/\s/g, '').length < 300)
        throw Error('PDF text is unreadable or image-only');
      let pages = null;
      try {
        pages =
          Number(
            execFileSync('pdfinfo', [pdfPath])
              .toString()
              .match(/^Pages:\s+(\d+)/m)?.[1],
          ) || null;
      } catch {}
      documents.push({
        id: filename.replace(/\.pdf$/i, ''),
        title: filename
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
        downloaded_on: new Date().toISOString().slice(0, 10),
        path: `reports/${filename}`,
        text_path: `extracted/${basename(textPath)}`,
        bytes: bytes.length,
        pages,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        status: 'downloaded_pdf_validated',
      });
      const validCount = documents.filter(
        (document) => document.status === 'downloaded_pdf_validated',
      ).length;
      await progress(
        job,
        'downloading',
        `Validated ${validCount} official report${validCount === 1 ? '' : 's'}`,
        validCount,
        { documents },
      );
    } catch (error) {
      documents.push({
        id: filename.replace(/\.pdf$/i, ''),
        title: filename,
        url,
        kind: 'Official filing',
        date: '',
        status: 'download_failed',
        error: error.message,
      });
    }
  }
  return { root, documents };
}

function evidenceFrom(documents, root) {
  const keywords =
    /revenue|income|profit|earnings per share|dividend|equity|cash flow|governance|related part|capital adequacy|deposit|provision|risk|segment|auditor|valuation/gi;
  const pieces = [];
  for (const document of documents.filter(
    (item) => item.status === 'downloaded_pdf_validated',
  )) {
    const text = readFileSync(join(root, document.text_path), 'utf8');
    const selected = [text.slice(0, 30_000)];
    let match;
    let count = 0;
    while ((match = keywords.exec(text)) && count < 220) {
      selected.push(
        text.slice(Math.max(0, match.index - 900), match.index + 2200),
      );
      count++;
    }
    pieces.push(
      `\n===== ${document.title} | ${document.url} =====\n${[...new Set(selected)].join('\n')}`.slice(
        0,
        180_000,
      ),
    );
  }
  return pieces.join('\n').slice(0, 880_000);
}

function writeOutputs(job, found, bundle, dossier) {
  const root = bundle.root;
  const manifest = {
    as_of: new Date().toISOString().slice(0, 10),
    documents: bundle.documents,
    web_sources: [{ id: `PSX-${job.ticker}`, url: found.psxUrl }],
  };
  atomic(join(root, 'sources.json'), JSON.stringify(manifest, null, 2) + '\n');
  atomic(
    join(root, 'RESEARCH.md'),
    `# ${job.ticker} — ${found.companyName}\n\nAs of: ${dossier.week} | Status: Complete | Confidence: ${dossier.confidence}\n\n${dossier.researchNarrative}\n\n## Investment thesis\n\n${dossier.thesis}\n\n## Risks\n\n${dossier.risk}\n\n## Catalysts\n\n${dossier.catalyst}\n`,
  );
  atomic(
    join(root, 'OPEN_QUESTIONS.md'),
    `# ${job.ticker} — Open questions\n\n${dossier.missingInformation.map((item) => `- ${item}`).join('\n')}\n`,
  );
  atomic(
    join(root, 'VERIFICATION.md'),
    `# ${job.ticker} — Verification\n\n- ${bundle.documents.filter((item) => item.status === 'downloaded_pdf_validated').length} PDFs validated by signature and text extraction.\n- Financial rows retain source titles, page locators and reporting basis.\n- Unsupported values remain null.\n- AI spending for this run is capped at US$0.50 by the server.\n`,
  );
  mkdirSync(join(root, 'data'), { recursive: true });
  atomic(
    join(root, 'data', 'company.json'),
    JSON.stringify(dossier, null, 2) + '\n',
  );
  const columns = [
    'year',
    'revenue',
    'profit',
    'eps',
    'ocf',
    'debt',
    'equity',
    'dividend',
    'source',
    'page',
    'basis',
    'verified',
  ];
  const csv =
    [
      columns.join(','),
      ...dossier.financials.map((row) =>
        columns.map((key) => JSON.stringify(row[key] ?? '')).join(','),
      ),
    ].join('\n') + '\n';
  atomic(join(root, 'data', 'annual-financials.csv'), csv);
  mkdirSync(join(root, 'history'), { recursive: true });
  atomic(
    join(root, 'history', `${dossier.week}-automatic.md`),
    `# ${job.ticker} dossier snapshot — ${dossier.week}\n\n${dossier.thesis}\n`,
  );
}

async function processJob(job) {
  let checkpoint = job.checkpoint || {};
  try {
    if (checkpoint.dossier && checkpoint.found) {
      await request('/api/research/helper', {
        method: 'POST',
        body: JSON.stringify({
          id: job.id,
          action: 'complete',
          dossier: checkpoint.dossier,
          companyName: checkpoint.found.companyName,
          sector: checkpoint.found.sector,
        }),
      });
      return;
    }
    await progress(
      job,
      'verifying',
      `Verifying ${job.ticker} on PSX`,
      checkpoint.documents?.length || 0,
      checkpoint,
    );
    const found = await discover(job);
    await progress(
      job,
      'finding_reports',
      `Found ${found.urls.length} official report candidate${found.urls.length === 1 ? '' : 's'}`,
      0,
      { ...checkpoint, found },
    );
    if (!found.urls.length)
      throw Error(
        'No official report links were found. Add or verify the company investor-relations source, then resume.',
      );
    const bundle = await downloadReports(job, found);
    const valid = bundle.documents.filter(
      (document) => document.status === 'downloaded_pdf_validated',
    );
    checkpoint = { found, documents: bundle.documents };
    if (!valid.length)
      throw Error(
        'Official links were found, but none produced a readable PDF. Partial download records were preserved.',
      );
    await progress(
      job,
      'extracting',
      `Preparing cited evidence from ${valid.length} validated report${valid.length === 1 ? '' : 's'}`,
      valid.length,
      checkpoint,
    );
    const evidence = evidenceFrom(bundle.documents, bundle.root);
    const synthesis = await request('/api/research/synthesize', {
      method: 'POST',
      body: JSON.stringify({
        id: job.id,
        ticker: job.ticker,
        companyName: found.companyName,
        evidence,
        documents: valid.map(({ title, url, kind, date }) => ({
          title,
          url,
          kind,
          date,
        })),
      }),
    });
    await progress(
      job,
      'validating',
      'Validating citations, score limits and dossier structure',
      valid.length,
      checkpoint,
    );
    writeOutputs(job, found, bundle, synthesis.dossier);
    checkpoint = { ...checkpoint, dossier: synthesis.dossier };
    await progress(
      job,
      'saving',
      'Local company files saved; updating the app dossier',
      valid.length,
      checkpoint,
    );
    await request('/api/research/helper', {
      method: 'POST',
      body: JSON.stringify({
        id: job.id,
        action: 'complete',
        dossier: synthesis.dossier,
        companyName: found.companyName,
        sector: found.sector,
      }),
    });
  } catch (error) {
    try {
      await request('/api/research/helper', {
        method: 'POST',
        body: JSON.stringify({
          id: job.id,
          action: 'attention',
          error: error.message,
          checkpoint,
        }),
      });
    } catch {}
  }
}

async function main() {
  mkdirSync(companiesRoot, { recursive: true });
  for (;;) {
    try {
      const { job } = await request('/api/research/helper');
      if (job) await processJob(job);
    } catch (error) {
      process.stderr.write(`[${new Date().toISOString()}] ${error.message}\n`);
    }
    await wait(15_000);
  }
}
void main();
