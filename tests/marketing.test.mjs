import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  appOrigin,
  hostRole,
  isMarketingPath,
  marketingOrigin,
  normalizeHost,
  parseSignupSource,
  parseSignupRef,
  robotsTxt,
  signInHref,
  SIGNUP_SOURCES,
  sitemapXml,
  splitEnabled,
} from '../lib/hosts.ts';
import { CALC_DEFAULTS, calcView, group, projectCalc, rs, rsShort } from '../lib/marketing-math.ts';
import { jsonLd, pageMetadata, PAGE_META, SITEMAP_PATHS, structuredData } from '../lib/marketing-seo.ts';
import { FAQ } from '../lib/marketing-faq.ts';
import { projectScenario } from '../lib/sip-blueprint.ts';

const CFG = { marketingHost: 'sipwise.trade', appHost: 'app.sipwise.trade' };

test('host roles: split on, off, and unknown hosts', () => {
  assert.equal(hostRole('sipwise.trade', CFG), 'marketing');
  assert.equal(hostRole('SIPWISE.trade:443', CFG), 'marketing');
  assert.equal(hostRole('app.sipwise.trade', CFG), 'app');
  // The old workers.dev address installed phones use keeps behaving like the app, not like the marketing site.
  assert.equal(hostRole('psx-portfolio-sip.suzairbukhari.workers.dev', CFG), 'single');
  assert.equal(hostRole('localhost:5173', {}), 'single');
  assert.equal(hostRole('sipwise.trade', { marketingHost: 'sipwise.trade' }), 'single');
  assert.equal(splitEnabled(CFG), true);
  assert.equal(splitEnabled({ marketingHost: '', appHost: '' }), false);
  assert.equal(normalizeHost(' Foo.Com:8080 '), 'foo.com');
});

test('sign-in links go to the app host with a closed-list source', () => {
  assert.equal(appOrigin(CFG), 'https://app.sipwise.trade');
  assert.equal(marketingOrigin(CFG), 'https://sipwise.trade');
  assert.equal(appOrigin({}), '');
  assert.equal(
    signInHref(CFG, 'home_hero'),
    'https://app.sipwise.trade/api/auth/google/login?return_to=%2F&src=home_hero',
  );
  assert.equal(signInHref({}, 'pricing'), '/api/auth/google/login?return_to=%2F&src=pricing');
  assert.equal(parseSignupSource('home_hero'), 'home_hero');
  assert.equal(parseSignupSource('<script>'), null);
  assert.equal(parseSignupSource(null), null);
  assert.equal(new Set(SIGNUP_SOURCES).size, SIGNUP_SOURCES.length);
  assert.equal(parseSignupRef('tiktok'), 'tiktok');
  assert.equal(parseSignupRef('TikTok'), null);
  assert.equal(parseSignupRef('<script>'), null);
  assert.equal(parseSignupRef(null), null);
});

test('the marketing host serves only public paths; everything else is an app page', () => {
  for (const p of ['/', '/features', '/security', '/pricing', '/guide', '/privacy', '/terms', '/download', '/feedback', '/pricing/']) {
    assert.equal(isMarketingPath(p), true, p);
  }
  for (const p of ['/reports', '/company/MEBL', '/activity', '/settings', '/admin/users', '/sip']) {
    assert.equal(isMarketingPath(p), false, p);
  }
});

test('robots.txt and sitemap per host', () => {
  assert.equal(robotsTxt('app', CFG), 'User-agent: *\nDisallow: /\n');
  const m = robotsTxt('marketing', CFG);
  assert.match(m, /Allow: \/features/);
  assert.match(m, /Disallow: \/api\//);
  assert.match(m, /Sitemap: https:\/\/sipwise\.trade\/sitemap\.xml/);
  const xml = sitemapXml('https://sipwise.trade', SITEMAP_PATHS);
  assert.match(xml, /<loc>https:\/\/sipwise\.trade\/pricing<\/loc>/);
  assert.equal((xml.match(/<url>/g) ?? []).length, SITEMAP_PATHS.length);
});

test('calculator maths equals the Future you projection', () => {
  const i = { monthly: 25000, years: 15, annualPct: 12, stepUpPct: 10 };
  const mine = projectCalc(i);
  const app = projectScenario({ monthly: 25000, annualPct: 12, stepUpPct: 10 }, {}, 15);
  assert.equal(mine.points.length, 15);
  mine.points.forEach((p, k) => {
    assert.equal(p.value, app[k + 1].value);
    assert.equal(p.invested, app[k + 1].invested);
  });
  // No raise: money in is monthly x 12 x years.
  const flat = projectCalc({ monthly: 10000, years: 5, annualPct: 0, stepUpPct: 0 });
  assert.equal(flat.points[4].invested, 600000);
  assert.equal(Math.round(flat.points[4].value), 600000);
});

test('formatting', () => {
  assert.equal(group(1234567.4), '1,234,567');
  assert.equal(rs(25000), 'Rs 25,000');
  assert.equal(rsShort(9530000), 'Rs 95.3 lakh');
  assert.equal(rsShort(20500000), 'Rs 2.05 crore');
  assert.equal(rsShort(80000), 'Rs 80,000');
});

test('the browser script gives exactly the same calculator output as the server code', () => {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(new URL('../public/marketing.js', import.meta.url), 'utf8'), sandbox);
  const web = sandbox.sipwiseMarketing;
  assert.ok(web, 'marketing.js exposes its maths when there is no document');
  const cases = [CALC_DEFAULTS, { monthly: 5000, years: 1, annualPct: 4, stepUpPct: 0 }, { monthly: 300000, years: 30, annualPct: 24, stepUpPct: 25 }, { monthly: 65000, years: 7, annualPct: 9, stepUpPct: 3 }];
  for (const c of cases) assert.deepEqual(JSON.parse(JSON.stringify(web.calcView(c))), calcView(c), JSON.stringify(c));
});

test('page metadata and structured data', () => {
  for (const [name, m] of Object.entries(PAGE_META)) {
    assert.ok(m.title.length <= 70, `${name} title`);
    assert.ok(m.description.length >= 80 && m.description.length <= 200, `${name} description`);
    assert.equal(pageMetadata(name).alternates.canonical, `https://sipwise.trade${m.path}`);
  }
  const home = structuredData('home');
  assert.deepEqual(home.map((d) => d['@type']), ['Organization', 'SoftwareApplication', 'FAQPage', 'VideoObject']);
  const faq = home.find((d) => d['@type'] === 'FAQPage');
  assert.equal(faq.mainEntity.length, FAQ.filter((f) => f.schema).length);
  assert.ok(FAQ.some((f) => f.urdu && !f.schema), 'the Urdu question stays out of the English FAQ markup');
  assert.equal(jsonLd([{ a: '</script><b>' }]).includes('</script>'), false);
  assert.equal(home[1].offers.price, '0');
});

test('marketing code reads no database and no session', () => {
  const files = [
    ...fs.readdirSync(new URL('../app/marketing/', import.meta.url)).map((f) => `app/marketing/${f}`),
    'lib/hosts.ts', 'lib/marketing-math.ts', 'lib/marketing-seo.ts', 'lib/marketing-faq.ts',
    'app/features/page.tsx', 'app/security/page.tsx', 'app/pricing/page.tsx', 'app/guide/page.tsx',
    'app/robots.txt/route.ts', 'app/sitemap.xml/route.ts',
  ];
  for (const f of files) {
    const text = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /@\/db|lib\/server|\bdb\(\)|getViewer|getCurrentUser|vault-store|DB\b/, `${f} must not touch the database or the session`);
  }
});

test('every marketing style is scoped under .mk so the app is never touched', () => {
  const css = fs.readFileSync(new URL('../app/marketing.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0;
  for (const line of css.split('\n')) {
    const t = line.trim();
    if (depth === 0 && t && !t.startsWith('}')) {
      assert.match(t, /^(\.mk\b|@media|@keyframes)/, `top-level rule is not scoped: ${t.slice(0, 60)}`);
    }
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
  }
  assert.doesNotMatch(css, /(^|[\s,}])(html|body)\s*[{,]/m);
});
