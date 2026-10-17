import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPortfolio } from '../../../lib/portfolio.ts';
import { addContents, contentsLabel, hasAnything, portfolioContents } from './scope.ts';

test('contentsLabel names what a portfolio holds and says Empty when nothing', () => {
  assert.equal(contentsLabel({ stocks: 21, plans: 1, funds: 2, metals: 0, currencies: 0 }), '21 stocks · 1 plan · 2 funds');
  assert.equal(contentsLabel({ stocks: 1, plans: 0, funds: 0, metals: 1, currencies: 0 }), '1 stock · 1 gold or silver item');
  assert.equal(contentsLabel({ stocks: 0, plans: 0, funds: 0, metals: 0, currencies: 0 }), 'Empty');
});

test('a portfolio with only funds and plans is not empty', () => {
  const p = blankPortfolio();
  p.assets = [
    { kind: 'plan', id: 'p1' },
    { kind: 'fund', id: 'f1' },
  ] as unknown as NonNullable<typeof p.assets>;
  const c = portfolioContents(p);
  assert.deepEqual(c, { stocks: 0, plans: 1, funds: 1, metals: 0, currencies: 0 });
  assert.equal(hasAnything(c), true);
  assert.equal(hasAnything(portfolioContents(blankPortfolio())), false);
  assert.deepEqual(addContents(c, c), { stocks: 0, plans: 2, funds: 2, metals: 0, currencies: 0 });
});
