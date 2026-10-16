import { useEffect, useRef, useState } from 'react';
import { COMPANY_BUDGET_USD_CNY, type CompanyBudget } from '../../../../packages/protocol/src/types/owner';
import { ownerError, ownerGoalRequest, type OwnerOverview } from '../../api/owner';
import { ApiError } from '../../api/client';
import { t, language, useLanguage } from '../../i18n';

export function OwnerBudget({ data, onDone }: { data: OwnerOverview; onDone: () => void }) {
  useLanguage();
  const budget=data.budget,lang=language(),usd=lang==='en',exchange=usd?COMPANY_BUDGET_USD_CNY:1;
  const initial=()=>budget?.configuration?.unitPriceCnyMicros!==undefined?budget.configuration.unitPriceCnyMicros/1000000:usd?0.3*COMPANY_BUDGET_USD_CNY:2;
  const [quantity,setQuantity]=useState(budget?.configuration?.tokenMillions??100),[priceCny,setPriceCny]=useState(initial),
    [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[saved,setSaved]=useState(false);
  const dirty=useRef(false);
  const pending=useRef<{tokenMillions:number;unitPrice:number;priceCurrency:'CNY'|'USD';expectedRevision:number;idempotencyKey:string}>();
  useEffect(()=>{if(!dirty.current){setQuantity(budget?.configuration?.tokenMillions??100);setPriceCny(initial());}},[budget?.revision,lang]);
  const money=(n:number)=>{const value=(n/1000000/exchange).toLocaleString(lang,{maximumFractionDigits:6});return usd?'$'+value:value+' 元';};
  const valid=budget&&budget.currency==='CNY'&&[budget.totalMicros,budget.spentMicros,budget.reservedMicros,budget.availableMicros].every(Number.isSafeInteger)&&[budget.totalMicros,budget.spentMicros,budget.reservedMicros].every(n=>n>=0);
  const amount=quantity*Math.round(priceCny*1000000),validInput=Number.isSafeInteger(quantity)&&quantity>=1&&quantity<=10000&&Number.isSafeInteger(amount)&&amount>0&&Number.isFinite(priceCny)&&priceCny>0;
  const spent=valid&&budget.totalMicros?Math.min(100,budget.spentMicros/budget.totalMicros*100):0;
  const reserved=valid&&budget.totalMicros?Math.min(100-spent,budget.reservedMicros/budget.totalMicros*100):0;
  async function save(){
    if(!budget||!validInput||busy)return;setBusy(true);setError(null);setSaved(false);
    try{
      const values={tokenMillions:quantity,unitPrice:priceCny/exchange,priceCurrency:usd?'USD' as const:'CNY' as const};
      if(!pending.current||pending.current.tokenMillions!==values.tokenMillions||pending.current.unitPrice!==values.unitPrice||pending.current.priceCurrency!==values.priceCurrency)pending.current={...values,expectedRevision:budget.revision,idempotencyKey:crypto.randomUUID()};
      const result=await ownerGoalRequest<CompanyBudget>('budget','POST',pending.current);
      pending.current=undefined;
      dirty.current=false;setQuantity(result.configuration!.tokenMillions);setPriceCny(result.configuration!.unitPriceCnyMicros/1000000);setSaved(true);onDone();
    }catch(e){if(e instanceof ApiError&&e.status!==0)pending.current=undefined;setError(e);onDone();}finally{setBusy(false);}
  }
  return <section id="owner-company-budget" className="owner-card" aria-label={t('Company money budget')}><h2>{t('Company money budget')}</h2>
    {!budget?<p>{t('Budget data unavailable.')}</p>:!valid?<p role="alert">{t('Budget data is invalid. Review the ledger before spending.')}</p>:<>
      <form className="owner-budget-settings" onSubmit={e=>{e.preventDefault();void save();}}>
        <label>{t('Token quantity (M)')}<input type="number" min="1" max="10000" step="1" required disabled={busy} value={quantity}
          onChange={e=>{dirty.current=true;setSaved(false);setQuantity(Number(e.target.value));}}/></label>
        <label>{t('Unit price ({0} / 1M Tokens)',[usd?'$':'元'])}<input type="number" min={0.000001/exchange} step="any" required disabled={busy} value={priceCny/exchange}
          onChange={e=>{dirty.current=true;setSaved(false);setPriceCny(Number(e.target.value)*exchange);}}/></label>
        <p>{t('Calculated allowance')}: <output aria-label={t('Calculated allowance')}>{validInput?money(amount):'—'}</output></p>
        <button className="owner-btn" disabled={busy||!validInput} type="submit">{t(busy?'Submitting…':'Save company budget')}</button>
      </form>
      {!!error&&<p className="owner-notice" role="alert">{ownerError(error)}</p>}
      {saved&&<p role="status">{t('Company budget saved.')}</p>}
      <p className="owner-muted">{t('Token quantity calculates the money allowance only. All people and tasks share it; actual model costs are charged.')}</p>
      <p className="owner-muted">{t('When the allowance is insufficient, change the token quantity manually and save a fresh allowance. Historical costs are retained.')}</p>
      <p className="owner-muted">{t('Saving a budget does not start a paused company.')} {t('Fixed exchange rate: $1 = 7 CNY.')}</p>
      <div className="owner-metric-grid">{([
        ['Total authorized budget',budget.totalMicros,''],['Settled cost',budget.spentMicros,''],
        ['Reserved cost',budget.reservedMicros,budget.reservedMicros>0?'warning':''],
        ['Available budget',budget.availableMicros,!budget.needsRefill&&budget.availableMicros>0?'ok':budget.activatedAt===null?'warning':'danger'],
      ] as const).map(([label,value,tone])=><div key={label} className={'owner-metric'+(tone?' owner-metric--'+tone:'')}><span>{t(label)}</span><strong>{money(value)}</strong></div>)}</div>
      <div className="owner-money-bar" role="img" aria-label={t('Settled cost')+': '+money(budget.spentMicros)+'; '+t('Reserved cost')+': '+money(budget.reservedMicros)+'; '+t('Available budget')+': '+money(budget.availableMicros)}><span style={{width:spent+'%'}}/><i style={{width:reserved+'%'}}/></div>
      {budget.activatedAt===null&&<p className="owner-notice">{t('Set the token quantity and unit price, then save the company budget.')}</p>}
      {budget.needsRefill&&<p className="owner-notice">{t('OWNER_COMPANY_BUDGET_EXHAUSTED')}</p>}
      {!!budget.historicalCostMicros&&<p className="owner-muted">{t('Historical cost before this budget')}: {money(budget.historicalCostMicros)}</p>}
      {!!data.costs?.length&&<details><summary>{t('Daily settled cost (Asia/Shanghai)')}</summary><div className="company-status-chart" role="img" aria-label={t('Daily settled cost (Asia/Shanghai)')}>
        {data.costs.map(c=><div key={c.day}><span>{c.day}</span><meter min={0} max={Math.max(1,...data.costs!.map(row=>Number.isFinite(row.micros)?row.micros:0))} value={Number.isFinite(c.micros)?Math.max(0,c.micros):0}/><strong>{money(c.micros)}</strong></div>)}
      </div></details>}
    </>}
  </section>;
}
