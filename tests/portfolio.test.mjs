import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialPortfolio,holdings,validate,plan,validateReview,researchInsights,researchWeightProfile,today,SECTORS,DEFAULT_RESEARCH_SETTINGS} from '../lib/portfolio.ts';
const month=today().slice(0,7),date=today();
const fresh=()=>({companies:[{ticker:'TEST',name:'Test',target:100,approved:true,screenDate:date,note:''}],trades:[],quotes:{TEST:{price:20,date,asOf:date,source:'https://dps.psx.com.pk/company/TEST',fetchedAt:new Date().toISOString()}},budgets:{[month]:10000}});
const trade=(id,shares,price,kind='buy',fees=0)=>({id,ticker:'TEST',date,kind,shares,price,fees,month:kind==='buy'?month:'',note:''});
test('weighted average includes buy fees and partial sales preserve average',()=>{const p=fresh();p.trades=[trade('1',100,10,'buy',10),trade('2',50,20,'buy',20),trade('3',50,30,'sell',5)];validate(p);const h=holdings(p)[0];assert.equal(h.shares,100);assert.equal(h.cost,1353.33);assert.equal(h.realized,818.33);assert.ok(Math.abs(h.average-2030/150)<1e-8)});
test('unknown opening cost stays unknown after purchases, resets after exit',()=>{const p=fresh();p.trades=[trade('0',10,null,'opening'),trade('1',10,20)];assert.equal(holdings(p)[0].cost,null);p.trades.push(trade('2',20,30,'sell'),trade('3',5,25));assert.equal(holdings(p)[0].cost,125);assert.equal(holdings(p)[0].realized,null)});
test('reject overselling, negative fees, future or impossible dates and duplicates',()=>{for(const entry of [trade('1',1,1,'sell'),{...trade('1',1,1),fees:-1},{...trade('1',1,1),date:'2099-01-01'},{...trade('1',1,1),date:'2026-02-30'}]){const p=fresh();p.trades=[entry];assert.throws(()=>validate(p))}const p=fresh();p.companies.push(p.companies[0]);assert.throws(()=>validate(p))});
test('voided trades are excluded without deleting their audit entries',()=>{const p=fresh();p.trades=[{...trade('1',10,10),voided:true},trade('2',20,20)];assert.equal(holdings(p)[0].shares,20);assert.equal(p.trades.length,2)});
test('monthly purchase spend includes fees and excludes other months/sales/opening',()=>{const p=fresh();p.trades=[trade('0',10,10,'opening'),trade('1',10,10,'buy',5),{...trade('2',5,10),month:'2025-01'},trade('3',1,20,'sell')];const r=plan(p,month);assert.equal(r.already,105);assert.equal(r.remaining,9895)});
test('missing and older prices block a plan unless older prices explicitly accepted',()=>{const p=fresh();delete p.quotes.TEST;assert.ok(plan(p,month).errors.length);p.quotes.TEST={price:20,date:'2025-01-01',asOf:'2025-01-01',source:'https://dps.psx.com.pk/company/TEST',fetchedAt:new Date().toISOString()};assert.ok(plan(p,month).errors.length);assert.equal(plan(p,month,0,true).errors.length,0)});
test('whole-share allocation is within budget, no paused purchases, no overweight MEBL additions',()=>{const p=initialPortfolio();p.quotes=JSON.parse(readFileSync(new URL('../lib/initial-quotes.json',import.meta.url)));const r=plan(p,month,.25,true);assert.equal(r.errors.length,0);assert.ok(r.invested<=r.remaining);assert.equal(r.invested+r.leftover,r.remaining);assert.equal(r.rows.find(x=>x.ticker==='MEBL').shares,0);assert.equal(r.rows.find(x=>x.ticker==='SYS').shares,0);for(const row of r.rows){assert.ok(Number.isInteger(row.shares));assert.ok(row.amount<=row.gap+.001)}});
test('many budgets remain affordable including fees and expensive single shares',()=>{for(let i=0;i<150;i++){const p=initialPortfolio();p.trades=[];p.budgets[month]=i*711.37;for(const [j,c] of p.companies.entries())p.quotes[c.ticker]={price:(j+1)*131.79,date,asOf:date,source:'https://dps.psx.com.pk/company/'+c.ticker,fetchedAt:new Date().toISOString()};const r=plan(p,month,1.27);assert.ok(r.invested<=r.remaining+.001);assert.ok(r.leftover>=0);assert.equal(Math.round((r.invested+r.leftover)*100),Math.round(r.remaining*100))}});
test('invalid AI weights are rejected and valid proposed targets leave holdings unchanged',()=>{const p=initialPortfolio();const weights=Object.fromEntries(p.companies.filter(c=>c.target).map(c=>[c.ticker,c.target]));assert.ok(validateReview({summary:'Keep current targets pending updated research.',weights},p));assert.throws(()=>validateReview({summary:'Invalid very concentrated targets.',weights:{...weights,MEBL:60}},p));assert.equal(holdings(p).find(h=>h.ticker==='MEBL').shares,615)});
test('opening statement and quote source validate without inventing costs',()=>{const p=initialPortfolio();p.quotes=JSON.parse(readFileSync(new URL('../lib/initial-quotes.json',import.meta.url)));validate(p);assert.equal(p.trades.length,21);assert.equal(holdings(p).filter(h=>h.shares>0&&h.cost===null).length,21)});
test('company sector must be one of the allowed sectors or empty for older records',()=>{
  const p=fresh();
  p.companies[0].sector='Bank';
  validate(p);
  assert.equal(holdings(p)[0].sector,'Bank');
  p.companies[0].sector='Not a sector';
  assert.throws(()=>validate(p));
  delete p.companies[0].sector;
  validate(p);
  for (const sector of SECTORS) {
    p.companies[0].sector=sector;
    validate(p);
  }
});
test('research settings accept configured values and reject out-of-range ones',()=>{
  const p=fresh();
  validate(p);
  p.researchSettings=DEFAULT_RESEARCH_SETTINGS;
  validate(p);
  p.researchSettings={model:'gpt-5-mini',maxOutputTokens:32000,reasoningEffort:'high',budgetUsd:1.5,maxAttempts:5};
  validate(p);
  for (const bad of [
    {...DEFAULT_RESEARCH_SETTINGS,model:'gpt-4o'},
    {...DEFAULT_RESEARCH_SETTINGS,reasoningEffort:'extreme'},
    {...DEFAULT_RESEARCH_SETTINGS,maxOutputTokens:1000},
    {...DEFAULT_RESEARCH_SETTINGS,maxOutputTokens:100000},
    {...DEFAULT_RESEARCH_SETTINGS,budgetUsd:0.01},
    {...DEFAULT_RESEARCH_SETTINGS,budgetUsd:10},
    {...DEFAULT_RESEARCH_SETTINGS,maxAttempts:0},
    {...DEFAULT_RESEARCH_SETTINGS,maxAttempts:6},
    {...DEFAULT_RESEARCH_SETTINGS,maxAttempts:2.5},
  ]) {
    const bp=fresh();
    bp.researchSettings=bad;
    assert.throws(()=>validate(bp));
  }
});
test('researchInsights reports a valuation gap only when both fair value and price are known',()=>{
  const p={companies:[],trades:[],budgets:{},quotes:{A:{price:100,date,asOf:date,source:'https://dps.psx.com.pk/company/A',fetchedAt:new Date().toISOString()}},research:[{ticker:'A',status:'Complete',score:80,fairValue:120,fairValueLow:100,fairValueHigh:140,thesis:'',risks:'',catalysts:'',conversationUrl:'',sources:[],financials:[],updatedAt:date}]};
  const [a,b]=researchInsights(p,['A','B']);
  assert.equal(a.status,'Complete');
  assert.equal(a.valuationPct,20);
  assert.equal(b.status,'None');
  assert.equal(b.score,null);
  assert.equal(b.valuationPct,null);
});
test('researchWeightProfile rewards higher scores and undervaluation, penalizes missing research, and always sums to 100 within the 20% cap',()=>{
  const q=(t)=>({price:80,date,asOf:date,source:'https://dps.psx.com.pk/company/'+t,fetchedAt:new Date().toISOString()});
  const dossier=(t,score,fairValue)=>({ticker:t,status:'Complete',score,fairValue,fairValueLow:fairValue*.8,fairValueHigh:fairValue*1.2,thesis:'',risks:'',catalysts:'',conversationUrl:'',sources:[],financials:[],updatedAt:date});
  const tickers=['HIGH','LOW','UNRESEARCHED','C','D','E'];
  const p={companies:[],trades:[],budgets:{},quotes:Object.fromEntries(tickers.map(t=>[t,q(t)])),research:[dossier('HIGH',95,120),dossier('LOW',30,60),dossier('C',60,80),dossier('D',60,80),dossier('E',60,80)]};
  const w=researchWeightProfile(p,tickers);
  assert.equal(Math.round(Object.values(w).reduce((a,b)=>a+b,0)*100)/100,100);
  for(const t of tickers) assert.ok(w[t]>=0&&w[t]<=20.01);
  assert.ok(w.HIGH>w.C);
  assert.ok(w.C>w.LOW);
  assert.ok(w.LOW>w.UNRESEARCHED);
});
