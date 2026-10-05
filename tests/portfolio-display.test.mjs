import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPortfolio, holdings, portfolioSummary, taxSummary, positionTimeline, dividendGross, validate } from '../lib/portfolio.ts';
import { accountFromPortfolio, dashboardPortfolio, normalizeAccount, replacePortfolio, removePortfolio, setPortfolioLocked } from '../lib/portfolio-account.ts';
import { portfolioValueSeries } from '../lib/price-history.ts';
import { refreshImportQuotes } from '../lib/import-refresh.ts';
import { prepareVault } from '../lib/vault-client.ts';
import { createVaultServer, memoryVaultCache } from './helpers/vault-server.mjs';
import * as cryptoAdapter from '../lib/vault-crypto.ts';

function ledger(price=100) {
  return {...blankPortfolio(),companies:[{ticker:'MEBL',name:'Meezan Bank',sector:'Bank',target:0,approved:false,screenDate:'',note:''}],trades:[{id:'buy',ticker:'MEBL',kind:'buy',shares:10,price,date:'2026-09-10',fees:0,month:'',note:''}],quotes:{MEBL:{price:300,date:'2026-10-05',asOf:'test',source:'https://dps.psx.com.pk/company/MEBL',fetchedAt:'2026-10-05T06:00:00Z'}},taxProfile:{filerStatus:'filer'}};
}
function account(a=ledger(),b=ledger(200)) {return normalizeAccount({...accountFromPortfolio(a),portfolios:[{id:'default',name:'My Portfolio',portfolio:a},{id:'b',name:'Finqalab',portfolio:b}]})}

test('one portfolio is the real editable ledger; two use a read-only display; returning to one preserves records',()=>{
  const original=ledger(),one=accountFromPortfolio(original);
  assert.equal(dashboardPortfolio(one),original);
  const two=replacePortfolio(one,blankPortfolio(),{id:'b',name:'Other'});
  assert.notEqual(dashboardPortfolio(two),original);
  assert.throws(()=>validate(dashboardPortfolio(two)),/Choose a portfolio/);
  assert.equal(dashboardPortfolio(removePortfolio(two,'b')),original);
  assert.throws(()=>removePortfolio(two,'default'),/default/);
});
test('shared dashboard holdings and taxes isolate each portfolio before summing',()=>{
  const a=ledger();a.trades.push({id:'sale',ticker:'MEBL',kind:'sell',shares:5,price:250,date:'2026-09-20',fees:0,month:'',note:''});
  const view=dashboardPortfolio(account(a));
  assert.equal(holdings(view)[0].shares,15);assert.equal(holdings(view)[0].cost,2500);
  assert.equal(portfolioSummary(holdings(view)).gain,2000);
  const tax=taxSummary(view);assert.equal(tax.totalRealizedGain,750);assert.equal(tax.totalCapitalGainsTax,112.5);
  assert.equal(tax.sales[0].tradeId,'default::sale');
});
test('missing price in one overlapping holding preserves the other priced subtotal and flags incompleteness',()=>{
  const b=ledger(200);b.quotes={};const view=dashboardPortfolio(account(ledger(),b));
  assert.equal(holdings(view)[0].value,null);
  assert.equal(portfolioSummary(holdings(view)).value,3000);
  assert.deepEqual(portfolioSummary(holdings(view)).missingPrice,['MEBL']);
  assert.equal(portfolioSummary(holdings(view)).gain,null);
});
test('split-aware consolidated history retains independent costs and dates',()=>{
  const a=ledger();a.stockSplits=[{id:'split',ticker:'MEBL',date:'2026-09-20',oldShares:1,newShares:2,note:''}];
  const b=ledger(200);b.trades[0].date='2026-09-25';const view=dashboardPortfolio(account(a,b));
  assert.deepEqual(positionTimeline(view,'MEBL').map((p)=>[p.date,p.shares,p.cost]),[['2026-09-10',10,1000],['2026-09-20',20,1000],['2026-09-25',30,3000]]);
  const sec=(d)=>Date.parse(`${d}T00:00:00Z`)/1000;
  const series=portfolioValueSeries(view,{MEBL:[[sec('2026-09-10'),100],[sec('2026-09-20'),50],[sec('2026-09-25'),200]]});
  assert.equal(series.points.at(-1).cost,3000);assert.equal(series.points.at(-1).value,6000);
});
test('identical dividend ids retain ownership and each original entitlement',()=>{
  const a=ledger(),b=ledger(200);b.trades[0].shares=20;
  a.dividends=[{id:'dividend',ticker:'MEBL',date:'2026-09-20',source:'manual',perShare:2,grossAmount:20,note:''}];b.dividends=structuredClone(a.dividends);b.dividends[0].grossAmount=40;
  const view=dashboardPortfolio(account(a,b));
  assert.deepEqual(view.dividends.map((d)=>dividendGross(view,d)),[20,40]);
  assert.equal(taxSummary(view).totalDividendIncomeGross,60);
});
test('locked portfolios stay in All while save, delete and account restore cannot change their records',async()=>{
  cryptoAdapter.setCryptoAdapter({randomBytes:(n)=>crypto.getRandomValues(new Uint8Array(n)),...cryptoAdapter.webCryptoAes(crypto.subtle)});
  try {
    const server=createVaultServer(),session=await (await prepareVault(server.as('display@example.test'),'correct horse battery staple',memoryVaultCache())).finish();
    await session.saveAccount(account(),session.revision);
    await session.saveAccount(setPortfolioLocked(session.account,'default',true),session.revision);
    assert.equal(portfolioSummary(holdings(dashboardPortfolio(session.account))).value,6000);
    await assert.rejects(()=>session.save(ledger(400),session.revision,{id:'default'}),/locked/);
    await assert.rejects(()=>session.saveAccount(accountFromPortfolio(),session.revision),/locked/);
    const bypass=setPortfolioLocked(session.account,'default',false);bypass.portfolios[0].portfolio=ledger(400);
    await assert.rejects(()=>session.saveAccount(bypass,session.revision),/locked/);
    await session.saveAccount(setPortfolioLocked(session.account,'default',false),session.revision);
    await session.save(ledger(400),session.revision,{id:'default'});
    assert.equal(session.portfolio.trades[0].price,400);
  } finally {cryptoAdapter.setCryptoAdapter(null)}
});
test('import refresh starts once, follows its public job, and exposes failure for retry',async()=>{
  let starts=0,polls=0;
  const response=(state)=>({quotes:{},stale:{},job:{state,requestedAt:'2026-10-05T06:00:00Z',tickers:['MEBL'],pending:[],outcomes:{},message:'Price refresh failed'}});
  await refreshImportQuotes({start:async()=>{starts++;return response('queued')},poll:async()=>{polls++;return response('completed')},sleep:async()=>{}});
  assert.equal(starts,1);assert.equal(polls,1);
  await assert.rejects(()=>refreshImportQuotes({start:async()=>response('failed'),poll:async()=>{throw Error('must not poll')}}),/Price refresh failed/);
  await assert.rejects(()=>refreshImportQuotes({start:async()=>{throw Error('offline')},poll:async()=>response('completed')}),/offline/);
});
