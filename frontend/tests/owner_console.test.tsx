import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OwnerActionCard } from '../src/features/owner/OwnerActionCard';
import { OwnerConsole } from '../src/features/owner/OwnerConsole';
import { OwnerInbox } from '../src/features/owner/OwnerInbox';
import { executeOwnerAction, fetchOwnerOverview } from '../src/api/owner';
import { enableWorlds, selectWorld } from '../src/api/worldScope';
import { setLanguage, t } from '../src/i18n';
const proposal={id:'batch-1',requiresApproval:true as const,action:{type:'qianji_chat' as const,targets:[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}],message:'Report'}};
const response=(data:unknown)=>({ok:true,headers:new Headers({'content-type':'application/json'}),json:async()=>data}) as Response;
beforeEach(()=>{localStorage.clear();setLanguage('en');window.history.replaceState(null,'','/OWNER#owner-goals');});afterEach(()=>{cleanup();vi.restoreAllMocks();enableWorlds(false);});
describe('Owner Mission Control',()=>{
  it('translates plan, resource, recruitment and Gene decision effects while preserving their parameters',()=>{
    const effects=[
      {type:'plan',approve:'Authorizes revision R{0} exactly as displayed: budget ¥{1}, its tasks and permitted external writes. Execution follows afterwards; approving is not completing the plan.',approveValues:[7,'2.5000'],reject:'Stops this pending revision R{0}; its tasks will not be authorized.',rejectValues:[7],types:['business_plan_approve','business_plan_reject']},
      {type:'resource',approve:'Confirms that {0} already exists and is usable, so the waiting tasks may continue.',approveValues:['crm:leads'],reject:'Rejects this resource request and stops the whole associated plan {0}, not just this item.',rejectValues:['Pilot'],types:['resource_provided','resource_reject']},
      {type:'recruit',approve:'Creates one person with this role and dispatches the initial task; model calls consume tokens; publication needs separate approval.',reject:'Stops this recruitment request; no person is created.',types:['recruit_approve','recruit_reject']},
      {type:'gene',approve:'Approves this direction only. Candidate freezing, privacy review and the exact-hash publication still require separate approvals before any new generation is born.',reject:'Rejects this direction; it stops advancing in the current generation.',types:['gene_proposal_approve','gene_proposal_reject']},
    ];
    render(<OwnerInbox onDone={()=>{}} items={effects.map((e,index)=>({id:String(index),type:e.type,title:e.type,summary:'Decision',priority:'normal',createdAt:1,source:'test',href:'/GENE',
      approveEffect:e.approve,approveEffectValues:e.approveValues,rejectEffect:e.reject,rejectEffectValues:e.rejectValues,actions:e.types.map(type=>({id:type,requiresApproval:true,action:{type}}))})) as any}/>);
    expect(screen.getByText(/Authorizes revision R7 exactly as displayed: budget ¥2.5000/)).toBeTruthy();
    expect(screen.getByText(/Confirms that crm:leads already exists/)).toBeTruthy();
    expect(screen.getByText(/whole associated plan Pilot/)).toBeTruthy();
    act(()=>setLanguage('zh-CN'));
    expect(screen.getByText(/批准当前展示的 R7 修订：预算 ¥2.5000/)).toBeTruthy();
    expect(screen.getByText(/停止待审批的 R7 修订/)).toBeTruthy();
    expect(screen.getByText(/确认资源 crm:leads 已经存在且可用/)).toBeTruthy();
    expect(screen.getByText(/停止整个关联方案 Pilot/)).toBeTruthy();
    expect(screen.getByText(/按该职责创建一位人物并派发初始任务/)).toBeTruthy();
    expect(screen.getByText(/停止本次招募请求，不创建人物/)).toBeTruthy();
    expect(screen.getByText(/候选冻结、隐私审查和准确哈希发布仍需各自批准/)).toBeTruthy();
    expect(screen.getByText(/拒绝此方向，停止它在当前代中的推进/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\{\d+\}|Authorizes|Confirms that|Creates one person|Rejects this/);
  });
  it('reports missing source timestamps explicitly in both languages',()=>{
    const content=<OwnerInbox onDone={()=>{}} items={[{id:'unknown',type:'external',title:'External outcome unknown',summary:'Task',priority:'critical',createdAt:null,source:'business_tasks',href:'/GENE?view=business'}]}/>;
    render(content);
    expect(screen.getByText('business_tasks · Time not recorded.')).toBeTruthy();
    act(()=>setLanguage('zh-CN'));expect(screen.getByText('business_tasks · 未记录时间。')).toBeTruthy();
  });
  it('limits batches to two in flight and retains per-recipient request keys after partial failure',async()=>{
    let active=0,max=0;const attempts:Record<string,string[]>={};let first=true;
    vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
      const id=String(input).split('/').at(-2)!;const key=JSON.parse(String(init!.body)).idempotencyKey;(attempts[id]??=[]).push(key);
      active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,10));active--;
      if(id==='b'&&first){first=false;throw new Error('connection lost');}return response({created:true});
    });
    const firstResult=await executeOwnerAction(proposal);expect(firstResult.filter(r=>!r.ok).map(r=>r.id)).toEqual(['b']);
    await executeOwnerAction(proposal);expect(max).toBe(2);expect(attempts.a).toHaveLength(1);expect(attempts.c).toHaveLength(1);expect(attempts.b).toHaveLength(2);for(const keys of Object.values(attempts))expect(new Set(keys).size).toBe(1);
    await expect(executeOwnerAction({id:'bad',requiresApproval:true,action:{type:'shell'}} as any)).rejects.toThrow('OWNER_ACTION_DENIED');
  });
  it('uses the global endpoint even when a World was selected',async()=>{
    enableWorlds(true);selectWorld('world-a');const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(response({}));await fetchOwnerOverview();expect(fetch.mock.calls[0]![0]).toBe('/api/owner/overview');
  });
});
