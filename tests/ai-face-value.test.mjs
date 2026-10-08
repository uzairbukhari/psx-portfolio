import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1 } from './helpers/d1.mjs';
import { restLike } from './helpers/d1-rest-like.mjs';
import { checkCandidate, quoteStatesValue, runAiFaceValues } from '../lib/ai-face-value.ts';
import { mergeFaceValueEvidence, resolveFaceValue } from '../lib/face-values.ts';
import { resolveConfig } from '../lib/ai-research/models.ts';

const URL1 = 'https://dps.psx.com.pk/download/document/1.pdf';
const PAGE = 'The ordinary shares of the Company have a face value of Rs. 10 each. The Company has not changed its face value since listing.';
const cand = (over = {}) => ({ faceValue: 10, effectiveFrom: '', sourceUrl: URL1, quote: 'The ordinary shares of the Company have a face value of Rs. 10 each', ...over });
const NOW = '2026-10-08T10:00:00.000Z';

test('a value the extractor reads from the cited page is stored verified', () => {
  const r = checkCandidate(cand(), PAGE, false, NOW);
  assert.equal(r.evidence.status, 'verified');
  assert.equal(r.evidence.faceValue, 10);
});

test('a quoted sentence the extractor misses is stored as ai, and must really be on the page', () => {
  const ok = checkCandidate(cand({ faceValue: 5, quote: 'capital is divided into shares at Rs 5 each', effectiveFrom: '2020-07-01' }), 'The capital is divided into shares at Rs 5 each since the split.', true, NOW);
  assert.equal(ok.evidence.status, 'ai');
  assert.match(checkCandidate(cand({ faceValue: 5, quote: 'par value of Rs 5 each', effectiveFrom: '2020-07-01' }), 'Nothing relevant here at all.', true, NOW).rejected, /quote not found/);
});

test('rejects unreadable pages, bad values, other instruments and undated values after a disclosed split', () => {
  assert.match(checkCandidate(cand(), null, false, NOW).rejected, /could not be fetched/);
  assert.match(checkCandidate(cand({ faceValue: 5000 }), PAGE, false, NOW).rejected, /out of range/);
  assert.match(checkCandidate(cand({ effectiveFrom: 'sometime' }), PAGE, false, NOW).rejected, /date not understood/);
  const pref = 'Redeemable preference shares carry a par value of Rs 10 each in this note.';
  assert.ok(checkCandidate(cand({ quote: 'preference shares carry a par value of Rs 10 each' }), pref, false, NOW).rejected);
  const undated = 'Our par value of Rs 10 each is stated in the memorandum.';
  assert.match(checkCandidate(cand({ quote: 'par value of Rs 10 each is stated' }), undated, true, NOW).rejected, /capital change/);
});

test('quoteStatesValue needs a face/par value context for the number', () => {
  assert.ok(quoteStatesValue('face value of Rs. 10 per share', 10));
  assert.ok(quoteStatesValue('shares of Rs 10/- each', 10));
  assert.ok(!quoteStatesValue('the share price rose to Rs 10', 10));
});

test('verified evidence replaces an AI value, and an AI value never overrides or contests verified evidence', () => {
  const ai = { faceValue: 10, effectiveFrom: '', sourceUrl: URL1, sourceLabel: 'Found by AI', evidence: 'q', verifiedAt: NOW, status: 'ai' };
  const ver = { ...ai, faceValue: 5, status: 'verified' };
  assert.equal(mergeFaceValueEvidence([ai], [ver])[0].faceValue, 5);
  assert.deepEqual(mergeFaceValueEvidence([ver], [ai]), []);
  assert.equal(resolveFaceValue([ai], '2026-01-01').status, 'verified');
  assert.equal(resolveFaceValue([ai], '2026-01-01').evidence.status, 'ai');
});

function setup() {
  const raw = createD1();
  const d1 = restLike(raw);
  raw.sqlite.exec("INSERT INTO security_catalog (ticker,name,source,first_seen_at,last_seen_at) VALUES ('AAAA','Alpha Ltd','t','x','x'),('BBBB','Beta Ltd','t','x','x')");
  return { raw, d1 };
}
const config = resolveConfig({});
const provider = (values, seen = []) => ({ id: 'openai', call: async (req) => { seen.push(req); return { json: { values }, model: 'gpt-5-mini', usage: { inputTokens: 1000, outputTokens: 300, cachedTokens: 0, searches: 2 }, sources: [] }; } });

test('the AI run stores a confirmed value, spends within the cap, skips tickers with evidence and sends only public data', async () => {
  const { raw, d1 } = setup();
  const seen = [];
  const report = await runAiFaceValues(
    { d1, provider: provider([cand()], seen), config, fetchText: async () => PAGE, now: () => NOW },
    { tickers: ['AAAA'], capUsd: 1 },
  );
  assert.equal(report.perTicker[0].stored, 1);
  assert.ok(report.costUsd > 0 && report.costUsd < 0.1);
  const row = raw.sqlite.prepare("SELECT face_value,status FROM security_face_values WHERE ticker='AAAA'").get();
  assert.deepEqual({ ...row }, { face_value: 10, status: 'verified' });
  assert.equal(raw.sqlite.prepare("SELECT face_value FROM security_catalog WHERE ticker='AAAA'").get().face_value, 10);
  assert.match(seen[0].input, /Alpha Ltd/);
  // Second run: evidence exists, no model call.
  const again = await runAiFaceValues({ d1, provider: provider([cand()], seen), config, fetchText: async () => PAGE, now: () => NOW }, { tickers: ['AAAA'] });
  assert.equal(again.perTicker[0].skipped, 'already has evidence');
  assert.equal(seen.length, 1);
});

test('an unsupported answer stores nothing, is not retried for 30 days, and the cap stops further lookups', async () => {
  const { raw, d1 } = setup();
  const io = (values) => ({ d1, provider: provider(values), config, fetchText: async () => 'nothing here', now: () => NOW });
  const first = await runAiFaceValues(io([cand()]), { tickers: ['AAAA'] });
  assert.equal(first.perTicker[0].stored, 0);
  assert.equal(raw.sqlite.prepare("SELECT COUNT(*) AS n FROM security_face_values").get().n, 0);
  const retry = await runAiFaceValues(io([cand()]), { tickers: ['AAAA'] });
  assert.equal(retry.perTicker[0].skipped, 'tried within 30 days');
  const capped = await runAiFaceValues(io([cand()]), { tickers: ['BBBB'], capUsd: 0.0001 });
  assert.equal(capped.capped, true);
  assert.equal(capped.perTicker[0].stored, 0);
});

test('the AI lookup code never reads accounts, holdings or the vault', () => {
  for (const file of ['lib/ai-face-value.ts', 'scripts/psx-face-value-scrape.mjs']) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.ok(!/portfolio|VAULT|vault|holding|email/i.test(text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), `${file} references private data`);
  }
});
