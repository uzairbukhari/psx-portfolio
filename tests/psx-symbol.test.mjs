import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPsxSymbol } from '../app/psx-symbol.ts';

test('PSX symbol verification returns the confirmed quote', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/quotes');
    assert.deepEqual(JSON.parse(options.body), { tickers: ['MEBL'] });
    return Response.json({ quotes: { MEBL: { price: 500 } } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  assert.deepEqual(await verifyPsxSymbol('MEBL'), { price: 500 });
});

test('PSX symbol verification rejects unavailable symbols with the API reason', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(
    { error: 'Every PSX quote request failed.', reasons: { NOPE: 'Unexpected PSX quote markup' } },
    { status: 400 },
  );
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(() => verifyPsxSymbol('NOPE'), /NOPE could not be confirmed.*markup/);
});
