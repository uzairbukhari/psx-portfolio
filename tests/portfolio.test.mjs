import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialPortfolio,holdings,validate,plan,validateReview,researchInsights,researchWeightProfile,reviewPrompt,today,SECTORS,DEFAULT_RESEARCH_SETTINGS,DEFAULT_RESEARCH_POLICY,sharesHeldOn,realizedSales,taxSummary,confirmedFunds} from '../lib/portfolio.ts';
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
test('researchInsights valuationPct matches the shared upside/downside formula',()=>{
  const p=fresh();
  p.research=[{ticker:'TEST',status:'Complete',score:80,fairValue:500,fairValueLow:400,fairValueHigh:600,thesis:'',risks:'',catalysts:'',conversationUrl:'',sources:[],financials:[],updatedAt:date}];
  p.quotes.TEST={price:550.98,date,asOf:date,source:'https://dps.psx.com.pk/company/TEST',fetchedAt:new Date().toISOString()};
  const insight=researchInsights(p,['TEST'])[0];
  assert.equal(insight.valuationPct,-9.25);
});
test('validate accepts a valuationProvenance of scenario-model or legacy, rejects any other value',()=>{
  const p=fresh();
  p.research=[{ticker:'TEST',status:'Complete',score:null,fairValue:null,fairValueLow:null,fairValueHigh:null,thesis:'',risks:'',catalysts:'',conversationUrl:'',sources:[],financials:[],updatedAt:date,valuationProvenance:'scenario-model'}];
  validate(p);
  p.research[0].valuationProvenance='legacy';
  validate(p);
  p.research[0].valuationProvenance='made-up';
  assert.throws(()=>validate(p));
});
test('reviewPrompt reflects the current dossier snapshot instead of a fixed historical paragraph',()=>{
  const p=initialPortfolio();
  const withNote=reviewPrompt(p,month);
  assert.ok(!withNote.includes('Prior research as of 2026-09-10'));
  const mebl=p.research.find(r=>r.ticker==='MEBL');
  mebl.thesis='Updated thesis for this test run.';
  assert.ok(reviewPrompt(p,month).includes('Updated thesis for this test run.'));
});
test('validate accepts every stance value and rejects an invalid one',()=>{
  const p=fresh();
  for(const stance of ['Consider','Watchlist','Avoid','Research incomplete']){
    p.research=[{ticker:'TEST',status:'Complete',score:null,fairValue:null,fairValueLow:null,fairValueHigh:null,thesis:'',risks:'',catalysts:'',conversationUrl:'',sources:[],financials:[],updatedAt:date,stance}];
    validate(p);
  }
  p.research[0].stance='Bullish';
  assert.throws(()=>validate(p));
});
test('validate accepts a well-formed screening record and rejects a bad status or date',()=>{
  const p=fresh();
  p.companies[0].screening={source:'PSX Shariah index',status:'Pass',effectiveDate:date,reviewDueDate:date};
  validate(p);
  p.companies[0].screening={source:'',status:'Pending',effectiveDate:'',reviewDueDate:''};
  validate(p);
  p.companies[0].screening={source:'x',status:'Maybe',effectiveDate:date,reviewDueDate:date};
  assert.throws(()=>validate(p));
  p.companies[0].screening={source:'x',status:'Pass',effectiveDate:'not-a-date',reviewDueDate:date};
  assert.throws(()=>validate(p));
});
test('validate accepts a numeric or null approvedMaxPrice, rejects zero/negative/non-finite',()=>{
  const p=fresh();
  p.companies[0].approvedMaxPrice=150.5;
  validate(p);
  p.companies[0].approvedMaxPrice=null;
  validate(p);
  p.companies[0].approvedMaxPrice=0;
  assert.throws(()=>validate(p));
  p.companies[0].approvedMaxPrice=-5;
  assert.throws(()=>validate(p));
  p.companies[0].approvedMaxPrice=Infinity;
  assert.throws(()=>validate(p));
});
test('validate accepts a number or null approvedResearchVersion, rejects a non-integer',()=>{
  const p=fresh();
  p.companies[0].approvedResearchVersion=1;
  validate(p);
  p.companies[0].approvedResearchVersion=null;
  validate(p);
  p.companies[0].approvedResearchVersion=1.5;
  assert.throws(()=>validate(p));
  p.companies[0].approvedResearchVersion={};
  assert.throws(()=>validate(p));
});
test('DEFAULT_RESEARCH_POLICY is inactive with the brief\'s initial caps and requires today\'s quote',()=>{
  assert.equal(DEFAULT_RESEARCH_POLICY.enabled,false);
  assert.equal(DEFAULT_RESEARCH_POLICY.companyCapPct,20);
  assert.equal(DEFAULT_RESEARCH_POLICY.sectorCapPct,30);
  assert.equal(DEFAULT_RESEARCH_POLICY.quoteFreshness,'today');
  assert.equal(DEFAULT_RESEARCH_POLICY.maxQuoteAgeDays,null);
});
test('validate accepts a well-formed researchPolicy and rejects an inconsistent one',()=>{
  const p=fresh();
  p.researchPolicy=DEFAULT_RESEARCH_POLICY;
  validate(p);
  p.researchPolicy={...DEFAULT_RESEARCH_POLICY,enabled:true,sectorCapPct:35};
  validate(p);
  p.researchPolicy={...DEFAULT_RESEARCH_POLICY,quoteFreshness:'dated',maxQuoteAgeDays:5};
  validate(p);
  p.researchPolicy={...DEFAULT_RESEARCH_POLICY,quoteFreshness:'dated',maxQuoteAgeDays:null};
  assert.throws(()=>validate(p),/dated/);
  p.researchPolicy={...DEFAULT_RESEARCH_POLICY,quoteFreshness:'today',maxQuoteAgeDays:5};
  assert.throws(()=>validate(p),/today/);
  p.researchPolicy={...DEFAULT_RESEARCH_POLICY,companyCapPct:150};
  assert.throws(()=>validate(p));
  p.researchPolicy={...DEFAULT_RESEARCH_POLICY,quoteFreshness:'weekly'};
  assert.throws(()=>validate(p));
});
const fundingEntry=(over={})=>({id:crypto.randomUUID(),month,source:'manual',amount:5000,note:'',createdAt:new Date().toISOString(),...over});
test('validate accepts a well-formed funding entry and rejects a bad source, month, or amount',()=>{
  const p=fresh();
  p.funding=[fundingEntry()];
  validate(p);
  p.funding=[fundingEntry({source:'carry-forward'})];
  validate(p);
  p.funding=[fundingEntry({source:'bogus'})];
  assert.throws(()=>validate(p));
  p.funding=[fundingEntry({month:'2026-13'})];
  assert.throws(()=>validate(p));
  p.funding=[fundingEntry({amount:0})];
  assert.throws(()=>validate(p));
  p.funding=[fundingEntry({amount:-5})];
  assert.throws(()=>validate(p));
});
test('validate requires linkedDividendId only for dividend-reinvestment, referencing a real non-voided dividend',()=>{
  const p=fresh();
  p.trades=[trade('1',10,10,'buy')];
  p.dividends=[{id:'d1',ticker:'TEST',date,source:'manual',perShare:2,grossAmount:200,note:''}];
  p.funding=[fundingEntry({source:'dividend-reinvestment',linkedDividendId:'d1',amount:200})];
  validate(p);
  p.funding=[fundingEntry({source:'dividend-reinvestment'})];
  assert.throws(()=>validate(p));
  p.funding=[fundingEntry({source:'dividend-reinvestment',linkedDividendId:'missing'})];
  assert.throws(()=>validate(p));
  p.funding=[fundingEntry({source:'manual',linkedDividendId:'d1'})];
  assert.throws(()=>validate(p));
});
test('validate rejects two non-voided funding entries linked to the same dividend, but allows it once one is voided',()=>{
  const p=fresh();
  p.trades=[trade('1',10,10,'buy')];
  p.dividends=[{id:'d1',ticker:'TEST',date,source:'manual',perShare:2,grossAmount:200,note:''}];
  p.funding=[
    fundingEntry({id:'f1',source:'dividend-reinvestment',linkedDividendId:'d1',amount:100}),
    fundingEntry({id:'f2',source:'dividend-reinvestment',linkedDividendId:'d1',amount:100}),
  ];
  assert.throws(()=>validate(p));
  p.funding[0].voided=true;
  validate(p);
});
test('confirmedFunds sums non-voided entries for the given month only, excluding other months and voided entries',()=>{
  const p=fresh();
  p.funding=[
    fundingEntry({month,amount:3000}),
    fundingEntry({month,amount:2000,voided:true}),
    fundingEntry({month:'2020-01',amount:9000}),
  ];
  assert.equal(confirmedFunds(p,month),3000);
});
test('confirmedFunds is zero with no funding array at all, never throws',()=>{
  const p=fresh();
  assert.equal(confirmedFunds(p,month),0);
});
test('fixture 9: unknown cash stays unconfirmed, a confirmed carry-forward and a reinvested dividend both count once, a voided purchase frees its spend back up',()=>{
  const p=fresh();
  p.trades=[trade('opening',100,10,'opening')];
  p.dividends=[{id:'d1',ticker:'TEST',date,source:'manual',perShare:5,grossAmount:500,note:''}];
  assert.equal(confirmedFunds(p,month),0);
  p.funding=[
    fundingEntry({id:'carry',source:'carry-forward',amount:10000}),
    fundingEntry({id:'div',source:'dividend-reinvestment',linkedDividendId:'d1',amount:500}),
  ];
  validate(p);
  assert.equal(confirmedFunds(p,month),10500);
  p.trades=[trade('t1',10,50,'buy',5)];
  assert.equal(confirmedFunds(p,month),10500);
  p.trades[0].voided=true;
  assert.equal(confirmedFunds(p,month),10500);
});
const savedPlanRow=(over={})=>({ticker:'TEST',name:'Test',price:20,shares:5,amount:100,eligible:true,exclusionReasons:[],...over});
const savedPlan=(over={})=>({
  id:crypto.randomUUID(),month,savedAt:new Date().toISOString(),
  policySnapshot:DEFAULT_RESEARCH_POLICY,budget:10000,confirmedFunds:5000,
  feePct:0.5,invested:100,leftover:4900,rows:[savedPlanRow()],...over,
});
test('validate accepts a well-formed saved plan and rejects a malformed one',()=>{
  const p=fresh();
  p.savedPlans=[savedPlan()];
  validate(p);
  p.savedPlans=[savedPlan({month:'2026-13'})];
  assert.throws(()=>validate(p));
  p.savedPlans=[savedPlan({rows:[savedPlanRow({shares:-1})]})];
  assert.throws(()=>validate(p));
  p.savedPlans=[savedPlan({invested:-5})];
  assert.throws(()=>validate(p));
});
test('validate accepts an empty savedPlans array and treats the field as fully optional',()=>{
  const p=fresh();
  validate(p);
  p.savedPlans=[];
  validate(p);
});
