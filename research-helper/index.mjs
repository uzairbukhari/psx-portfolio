#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
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
const toolPath = (configured, name) => {
  if (configured && existsSync(configured)) return configured;
  return ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin']
    .map((directory) => join(directory, name))
    .find(existsSync) || name;
};
const pdftotextPath = toolPath(config.pdftotextPath, 'pdftotext');
const pdfinfoPath = toolPath(config.pdfinfoPath, 'pdfinfo');
const curlPath = toolPath(config.curlPath, 'curl');
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
const credibleResearchHost = (host, issuerHosts = []) =>
  issuerHosts.includes(host) ||
  issuerHosts.includes(host.replace(/^www\./, '')) ||
  /(^|\.)(psx\.com\.pk|secp\.gov\.pk|sbp\.org\.pk|pacra\.com|jcrvis\.com\.pk|reuters\.com|dawn\.com|brecorder\.com|pakistantoday\.com\.pk|arifhabibltd\.com|akdsl\.com|topline\.com\.pk|ktrade\.pk)$/.test(
    host.replace(/^www\./, ''),
  );
async function externalResearch(query, issuerHosts) {
  const searchUrl =
    'https://www.bing.com/search?format=rss&q=' + encodeURIComponent(query);
  try {
    const result = await fetchText(searchUrl);
    const urls = [...result.text.matchAll(/<link>(https?:[^<]+)<\/link>/gi)]
      .map((match) => match[1].replace(/&amp;/g, '&'))
      .filter((url) => {
        try {
          return credibleResearchHost(new URL(url).host, issuerHosts);
        } catch {
          return false;
        }
      })
      .slice(0, 8);
    const sources = [];
    for (const url of urls) {
      try {
        const page = await fetchText(url);
        const text = cleanHtml(page.text).slice(0, 45_000);
        if (text.length >= 500)
          sources.push({
            title:
              page.text.match(/<title[^>]*>([^<]+)/i)?.[1]?.trim() ||
              new URL(page.finalUrl).host,
            url: page.finalUrl,
            text,
          });
      } catch {}
    }
    return sources;
  } catch {
    return [];
  }
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
  const companyName = title || heading || job.companyName;
  const sector =
    cleanHtml(page.text.match(/Sector[\s\S]{0,350}/i)?.[0] || '')
      .replace(/^Sector\s*/i, '')
      .slice(0, 100) || job.sector;
  const psxHost = new URL(psxUrl).host;
  const websiteBlock = page.text.match(
    /item__head["'][^>]*>WEBSITE<\/div>[\s\S]{0,500}?href=["']([^"']+)["']/i,
  );
  const companyWebsite = websiteBlock
    ? absolute(websiteBlock[1], psxUrl)
    : null;
  const price = Number(
    page.text.match(/quote__close["'][^>]*>Rs\.\s*([0-9,.]+)/i)?.[1]?.replace(
      /,/g,
      '',
    ),
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
  let annualPdfs = [];
  try {
    const reportArchive = await fetchText(
      `https://dps.psx.com.pk/company/reports/${job.ticker}`,
    );
    annualPdfs = [...reportArchive.text.matchAll(/<tr>[\s\S]*?<\/tr>/gi)]
      .map((match) => match[0])
      .filter((row) => /<td>\s*<a[^>]*>Annual<\/a>/i.test(row))
      .flatMap((row) => links(row, reportArchive.finalUrl))
      .reverse()
      .slice(0, 5);
  } catch {}
  const pages = companyWebsite
    ? [
        companyWebsite,
        absolute('/investors/financial-reports', companyWebsite),
        absolute('/investors/annual-reports', companyWebsite),
        absolute('/publications', companyWebsite),
      ].filter(Boolean)
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
        if (/\.pdf(?:$|\?)/i.test(link))
          discovered.push(link);
        else if (/annual|financial|investor|report|result/i.test(link))
          pages.push(link);
      }
    } catch {}
  }
  const issuerHosts = companyWebsite
    ? [new URL(companyWebsite).host.replace(/^www\./, '')]
    : [];
  const webSources = [
    {
      title: `PSX company page for ${job.ticker}`,
      url: psxUrl,
      text: cleanHtml(page.text).slice(0, 90_000),
    },
    ...(await externalResearch(
      `${companyName} ${job.ticker} Pakistan investment research rating industry outlook`,
      issuerHosts,
    )),
  ];
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
    market: {
      price: Number.isFinite(price) && price > 0 ? price : null,
      priceDate: new Date().toISOString().slice(0, 10),
      pe: Number.isFinite(marketPe) && marketPe > 0 ? marketPe : null,
    },
    webSources,
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
      const completedCount = documents.filter(
        (document) => document.status === 'downloaded_pdf_validated',
      ).length;
      await progress(
        job,
        'downloading',
        `Checking report ${index + 1} of ${found.urls.length}`,
        completedCount,
        { documents },
      );
      let bytes;
      if (existsSync(pdfPath)) bytes = readFileSync(pdfPath);
      else if (new URL(url).host === 'financials.psx.com.pk') {
        const temporary = pdfPath + '.download';
        try {
          execFileSync(
            curlPath,
            [
              '--location', '--fail', '--silent', '--show-error',
              '--max-time', '180',
              '--user-agent', 'Mozilla/5.0 PSX Research Helper/1.0',
              '--output', temporary,
              url,
            ],
            { timeout: 190_000 },
          );
          bytes = readFileSync(temporary);
          if (!hasPdfSignature(bytes)) throw Error('download was not a PDF');
          renameSync(temporary, pdfPath);
        } catch (error) {
          if (existsSync(temporary)) unlinkSync(temporary);
          throw error;
        }
      }
      else {
        const response = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 PSX Research Helper/1.0' },
          redirect: 'follow',
          signal: AbortSignal.timeout(180_000),
        });
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        bytes = Buffer.from(await response.arrayBuffer());
        if (!hasPdfSignature(bytes)) throw Error('download was not a PDF');
        atomic(pdfPath, bytes);
      }
      if (!hasPdfSignature(bytes)) throw Error('saved file is not a PDF');
      if (!existsSync(textPath)) {
        const raw = execFileSync(pdftotextPath, ['-layout', pdfPath, '-'], {
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
            execFileSync(pdfinfoPath, [pdfPath])
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
      process.stderr.write(
        `[${new Date().toISOString()}] ${job.ticker} ${filename}: ${error.message}\n`,
      );
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

function evidenceFrom(documents, root, webSources = []) {
  const keywords =
    /six.year|financial highlight|revenue|sales|income|profit|earnings per share|dividend|equity|cash flow|statement of financial position|statement of profit|governance|related part|capital adequacy|deposit|provision|risk|segment|auditor|valuation|reserve|production|circular debt/gi;
  const pieces = [];
  for (const document of documents.filter(
    (item) => item.status === 'downloaded_pdf_validated',
  )) {
    keywords.lastIndex = 0;
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
  for (const source of webSources)
    pieces.push(`\n===== WEB SOURCE: ${source.title} | ${source.url} =====\n${source.text}`);
  return pieces.join('\n').slice(0, 880_000);
}

function writeOutputs(job, found, bundle, dossier) {
  const root = bundle.root;
  const manifest = {
    as_of: new Date().toISOString().slice(0, 10),
    documents: bundle.documents,
    web_sources: found.webSources.map((source, index) => ({
      id: index === 0 ? `PSX-${job.ticker}` : `WEB-${index}`,
      title: source.title,
      url: source.url,
    })),
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
      checkpoint.dossier.ticker = job.ticker;
      checkpoint.dossier.name = checkpoint.found.companyName;
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
        `Official links were found, but none produced a readable PDF. ${bundle.documents
          .map((document) => document.error)
          .filter(Boolean)
          .slice(0, 3)
          .join('; ') || 'Partial download records were preserved.'}`,
      );
    await progress(
      job,
      'extracting',
      `Preparing cited evidence from ${valid.length} validated report${valid.length === 1 ? '' : 's'}`,
      valid.length,
      checkpoint,
    );
    const evidence = evidenceFrom(
      bundle.documents,
      bundle.root,
      found.webSources,
    );
    const synthesis = await request('/api/research/synthesize', {
      method: 'POST',
      body: JSON.stringify({
        id: job.id,
        ticker: job.ticker,
        companyName: found.companyName,
        market: found.market,
        evidence,
        documents: valid.map(({ title, url, kind, date }) => ({
          title,
          url,
          kind,
          date,
        })).concat(
          found.webSources.map((source) => ({
            title: source.title,
            url: source.url,
            kind: 'Web research',
            date: found.market.priceDate,
          })),
        ),
      }),
    });
    synthesis.dossier.ticker = job.ticker;
    synthesis.dossier.name = found.companyName;
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
