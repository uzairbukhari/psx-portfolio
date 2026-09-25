import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialPortfolio,holdings,validate,plan,validateReview,researchInsights,researchWeightProfile,today,SECTORS,DEFAULT_RESEARCH_SETTINGS,sharesHeldOn,realizedSales,taxSummary} from '../lib/portfolio.ts';
const month=today().slice(0,7),date=today();
const fresh=()=>({companies:[{ticker:'TEST',name:'Test',target:100,approved:true,screenDate:date,note:''}],trades:[],quotes:{TEST:{price:20,date,asOf:date,source:'https://dps.psx.com.pk/company/TEST',fetchedAt:new Date().toISOString()}},budgets:{[month]:10000}});
const trade=(id,shares,price,kind='buy',fees=0)=>({id,ticker:'TEST',date,kind,shares,price,fees,month:kind==='buy'?month:'',note:''});
test('weighted average includes buy fees and partial sales preserve average',()=>{const p=fresh();p.trades=[trade('1',100,10,'buy',10),trade('2',50,20,'buy',20),trade('3',50,30,'sell',5)];validate(p);const h=holdings(p)[0];assert.equal(h.shares,100);assert.equal(h.cost,1353.33);assert.equal(h.realized,818.33);assert.ok(Math.abs(h.average-2030/150)<1e-8)});
test('unknown opening cost stays unknown after purchases, resets after exit',()=>{const p=fresh();p.trades=[trade('0',10,null,'opening'),trade('1',10,20)];assert.equal(holdings(p)[0].cost,null);p.trades.push(trade('2',20,30,'sell'),trade('3',5,25));assert.equal(holdings(p)[0].cost,125);assert.equal(holdings(p)[0].realized,null)});
test('reject overselling, negative fees, future or impossible dates and duplicates',()=>{for(const entry of [trade('1',1,1,'sell'),{...trade('1',1,1),fees:-1},{...trade('1',1,1),date:'2099-01-01'},{...trade('1',1,1),date:'2026-02-30'}]){const p=fresh();p.trades=[entry];assert.throws(()=>validate(p))}const p=fresh();p.companies.push(p.companies[0]);assert.throws(()=>validate(p))});
test('voided trades are excluded without deleting their audit entries',()=>{const p=fresh();p.trades=[{...trade('1',10,10),voided:true},trade('2',20,20)];assert.equal(holdings(p)[0].shares,20);assert.equal(p.trades.length,2)});
test('SYS 5-for-1 split adjusts only pre-split shares and preserves total cost',()=>{
  const p=fresh();
  p.companies[0]={...p.companies[0],ticker:'SYS',name:'Systems'};
  p.quotes={SYS:{price:120,date,asOf:date,source:'https://dps.psx.com.pk/company/SYS',fetchedAt:new Date().toISOString()}};
  p.trades=[
    {id:'1',ticker:'SYS',kind:'buy',date:'2025-02-06',shares:10,price:566,fees:9.8135,month:'2025-02',note:''},
    {id:'2',ticker:'SYS',kind:'buy',date:'2025-02-17',shares:5,price:550,fees:4.7687,month:'2025-02',note:''},
    {id:'3',ticker:'SYS',kind:'buy',date:'2025-04-08',shares:5,price:514,fees:4.4582,month:'2025-04',note:''},
    {id:'4',ticker:'SYS',kind:'buy',date:'2025-05-13',shares:20,price:535,fees:18.5575,month:'2025-05',note:''},
    {id:'5',ticker:'SYS',kind:'buy',date:'2025-10-08',shares:140,price:154,fees:37.891,month:'2025-10',note:''},
    {id:'6',ticker:'SYS',kind:'buy',date:'2025-10-22',shares:6,price:161,fees:2.415,month:'2025-10',note:''},
  ];
  p.stockSplits=[{id:'split',ticker:'SYS',date:'2025-06-02',oldShares:1,newShares:5,note:''}];
  validate(p);
  const h=holdings(p)[0];
  assert.equal(h.shares,346);
  assert.equal(h.cost,44283.9);
  assert.equal(Math.round(h.average*100),12799);
});
test('splits precede same-day trades, support multiple events, sales, and historical dividends',()=>{
  const p=fresh();
  p.trades=[
    {...trade('1',10,100),date:'2025-01-01',month:'2025-01'},
    {...trade('2',5,40),date:'2025-02-01',month:'2025-02'},
    {...trade('3',15,50,'sell'),date:'2025-03-01',month:''},
  ];
  p.stockSplits=[
    {id:'s1',ticker:'TEST',date:'2025-02-01',oldShares:1,newShares:2,note:''},
    {id:'s2',ticker:'TEST',date:'2025-03-01',oldShares:1,newShares:3,note:''},
  ];
  p.dividends=[{id:'d',ticker:'TEST',date:'2025-02-01',source:'manual',perShare:1,grossAmount:25,note:''}];
  validate(p);
  assert.equal(sharesHeldOn(p,'TEST','2025-02-01'),25);
  assert.equal(holdings(p)[0].shares,60);
  assert.equal(taxSummary(p).dividends[0].grossAmount,25);
  assert.equal(realizedSales(p)[0].costBasis,240);
});
test('split validation, voiding, unknown cost, and post-split quote dates are enforced',()=>{
  const p=fresh();
  p.trades=[{...trade('0',10,null,'opening'),date:'2025-01-01',month:''}];
  p.stockSplits=[{id:'s',ticker:'TEST',date:'2025-06-02',oldShares:1,newShares:5,note:''}];
  p.quotes.TEST={...p.quotes.TEST,date:'2025-06-01'};
  validate(p);
  assert.equal(holdings(p)[0].shares,50);
  assert.equal(holdings(p)[0].cost,null);
  assert.equal(holdings(p)[0].quote,undefined);
  p.stockSplits[0].voided=true;
  assert.equal(holdings(p)[0].shares,10);
  for(const bad of [
    {id:'x',ticker:'TEST',date:'2025-06-02',oldShares:1,newShares:1,note:''},
    {id:'x',ticker:'TEST',date:'2099-01-01',oldShares:1,newShares:5,note:''},
  ]) assert.throws(()=>validate({...p,stockSplits:[bad]}));
  assert.throws(()=>validate({...p,stockSplits:[
    {id:'a',ticker:'TEST',date:'2025-06-02',oldShares:1,newShares:5,note:''},
    {id:'b',ticker:'TEST',date:'2025-06-02',oldShares:1,newShares:5,note:''},
  ]}));
  assert.throws(()=>validate({...p,trades:[{...trade('0',3,10),date:'2025-01-01'}],stockSplits:[
    {id:'fractional',ticker:'TEST',date:'2025-06-02',oldShares:2,newShares:3,note:''},
  ]}));
});
test('Finqalab imports may predate an AHL opening balance, but active broker keys stay unique',()=>{
  const p=fresh();
  p.trades=[
    {...trade('ahl-opening',10,null,'opening'),date:'2026-09-09',month:'',note:'AHL opening balance'},
    {...trade('finqalab-buy',5,10),date:'2025-10-03',month:'2025-10',source:'finqalab',externalId:'finqalab:1'},
  ];
  validate(p);
  assert.equal(holdings(p)[0].shares,15);
  p.trades.push({...trade('finqalab-copy',1,10),source:'finqalab',externalId:'finqalab:1'});
  assert.throws(()=>validate(p));
});
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
test('sharesHeldOn tracks running shares across buys and sells',()=>{
  const p=fresh();
  p.trades=[trade('1',100,10,'buy'),trade('2',30,20,'sell')];
  assert.equal(sharesHeldOn(p,'TEST','2000-01-01'),0);
  assert.equal(sharesHeldOn(p,'TEST',date),70);
});
test('realizedSales returns one record per sale and sums to holdings realized',()=>{
  const p=fresh();
  p.trades=[trade('1',100,10,'buy',10),trade('2',50,20,'buy',20),trade('3',50,30,'sell',5)];
  validate(p);
  const sales=realizedSales(p);
  assert.equal(sales.length,1);
  assert.equal(sales[0].shares,50);
  assert.equal(sales[0].realizedGain,818.33);
  assert.equal(holdings(p)[0].realized,sales.reduce((a,s)=>a+s.realizedGain,0));
});
test('realizedSales marks gain and cost basis null when average cost unknown',()=>{
  const p=fresh();
  p.trades=[trade('0',10,null,'opening'),trade('1',10,20),trade('2',20,30,'sell'),trade('3',5,25)];
  const sales=realizedSales(p);
  assert.equal(sales.length,1);
  assert.equal(sales[0].realizedGain,null);
  assert.equal(sales[0].costBasis,null);
});
test('taxSummary applies filer/non-filer rates to sells and manual dividends, losses pay no tax',()=>{
  const p=fresh();
  p.trades=[trade('1',100,10,'buy'),trade('2',50,5,'sell')];
  p.dividends=[{id:'d1',ticker:'TEST',date,source:'manual',perShare:2,grossAmount:100,note:''}];
  p.taxProfile={filerStatus:'filer'};
  validate(p);
  let t=taxSummary(p);
  assert.equal(t.sales[0].realizedGain,-250);
  assert.equal(t.sales[0].tax,0);
  assert.equal(t.dividends[0].tax,15);
  assert.equal(t.dividends[0].netAmount,85);
  p.taxProfile={filerStatus:'non-filer'};
  t=taxSummary(p);
  assert.equal(t.dividends[0].tax,30);
  assert.equal(t.dividends[0].netAmount,70);
});
test('imported dividend tax derives from stored gross/net regardless of filer status',()=>{
  const p=fresh();
  p.dividends=[{id:'d1',ticker:'TEST',date,source:'import',grossAmount:35,netAmount:30,externalId:'EV1',note:''}];
  validate(p);
  assert.equal(taxSummary(p).dividends[0].tax,5);
  p.taxProfile={filerStatus:'non-filer'};
  assert.equal(taxSummary(p).dividends[0].netAmount,30);
});
test('taxSummary returns null tax fields when filer status is not set',()=>{
  const p=fresh();
  p.trades=[trade('1',100,10,'buy'),trade('2',50,20,'sell')];
  validate(p);
  const t=taxSummary(p);
  assert.equal(t.sales[0].tax,null);
  assert.equal(t.totalCapitalGainsTax,null);
  assert.equal(t.netRealizedReturn,null);
});
test('validate rejects dividends for unknown tickers, before shares held, duplicate imports, net exceeding gross, and bad filer status',()=>{
  let p=fresh();
  p.dividends=[{id:'1',ticker:'OTHER',date,source:'manual',perShare:1,grossAmount:1,note:''}];
  assert.throws(()=>validate(p));

  p=fresh();
  p.dividends=[{id:'1',ticker:'TEST',date,source:'manual',perShare:1,grossAmount:1,note:''}];
  assert.throws(()=>validate(p));

  p=fresh();
  p.trades=[trade('1',10,10,'buy')];
  p.dividends=[
    {id:'1',ticker:'TEST',date,source:'import',grossAmount:10,netAmount:8,externalId:'E1',note:''},
    {id:'2',ticker:'TEST',date,source:'import',grossAmount:10,netAmount:8,externalId:'E1',note:''},
  ];
  assert.throws(()=>validate(p));

  p=fresh();
  p.trades=[trade('1',10,10,'buy')];
  p.dividends=[{id:'1',ticker:'TEST',date,source:'import',grossAmount:10,netAmount:20,externalId:'E1',note:''}];
  assert.throws(()=>validate(p));

  p=fresh();
  p.taxProfile={filerStatus:'exempt'};
  assert.throws(()=>validate(p));
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
