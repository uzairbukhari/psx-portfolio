'use client';
import { Dossier } from './original-dossier';
import { blank, score, type Company as DossierCompany } from './research-data';
import { type Company, type ResearchCompany } from '@/lib/portfolio';
import { resolveValuation } from '@/lib/valuation';
type Props = { draft: ResearchCompany; company?: Company; onChange:(v:ResearchCompany)=>void; onBack:()=>void; onSave:(v?:ResearchCompany)=>Promise<void>; onExport:()=>void };
export default function DossierExperience({draft,company,onChange,onBack,onSave}:Props){
 const details=draft.details as Partial<DossierCompany>|undefined;
 const full:DossierCompany={...blank(draft.ticker,company?.name??draft.ticker,company?.sector||''),...details,ticker:draft.ticker,name:details?.name||company?.name||draft.ticker,status:draft.status==='Queue'?'Queued':draft.status,thesis:draft.thesis,risk:draft.risks,catalyst:draft.catalysts,conversation:draft.conversationUrl,week:details?.week??draft.updatedAt,financials:details?.financials??draft.financials.map(f=>({...f,year:Number(f.year),ocf:null,equity:null,dividend:null,source:'',page:'',basis:'',verified:false})),documents:details?.documents??draft.sources.map(url=>({title:url,url,kind:'Report / filing',date:''}))};
 return <div className="original-research-dossier">{!details&&<p className="help">This record used the earlier simplified importer. Re-import your original research backup to recover source annotations, valuation scenarios and category scores.</p>}<Dossier key={draft.ticker} company={full} onBack={onBack} onSave={async(c,message)=>{
 const updated={...c,history:[...c.history,{date:new Date().toISOString(),text:message}]};
 const valuation=resolveValuation({scenarios:c.scenarios,legacyLow:draft.fairValueLow,legacyBase:draft.fairValue,legacyHigh:draft.fairValueHigh});
 const next:ResearchCompany={...draft,details:updated,status:c.status==='Queued'?'Queue':c.status as ResearchCompany['status'],score:score(c),fairValue:valuation.base,fairValueLow:valuation.low,fairValueHigh:valuation.high,valuationProvenance:valuation.provenance==='unavailable'?undefined:valuation.provenance,thesis:c.thesis,risks:c.risk,catalysts:c.catalyst,conversationUrl:c.conversation,sources:c.documents.map(d=>d.url),financials:c.financials.map(f=>({...f,year:String(f.year),roe:null})),updatedAt:new Date().toISOString().slice(0,10)};
 await onSave(next);onChange(next);
 }}/></div>;
}
