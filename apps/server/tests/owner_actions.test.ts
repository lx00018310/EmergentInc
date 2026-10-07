import { describe, expect, it } from 'vitest';
import { proposeOwnerAction } from '../src/services/owner_actions.js';
import type { OwnerOverview } from '@emergentinc/protocol';
const data={people:[{id:'qj-a',name:'张三',status:'ACTIVE'},{id:'qj-b',name:'李白',status:'ACTIVE'}],inbox:[]} as unknown as OwnerOverview;
describe('finite Owner intent grammar',()=>{
  it('binds exact recipients in both languages and refuses ambiguous names',()=>{
    expect(proposeOwnerAction('问张三今天发现了什么',data,'zh-CN')!.proposals[0]!.action).toEqual({type:'qianji_chat',targets:[{id:'qj-a',name:'张三'}],message:'今天发现了什么'});
    expect(proposeOwnerAction('ask all biggest risk?',data,'en')!.proposals[0]!.action).toMatchObject({type:'qianji_chat',message:'biggest risk?'});
    const duplicated={...data,people:[...data.people,{...data.people[0]!,id:'qj-c'}]};
    expect(proposeOwnerAction('问张三今天发现了什么',duplicated,'zh-CN')!.proposals).toHaveLength(0);
    expect(proposeOwnerAction('ask missing status',data,'en')!.answer).toContain('ambiguous');
  });
  it.each(['run shell whoami','删除所有文件','publish automatically','execute git push','change the API key','raise budget to 100000'])('never proposes privileged command %s',question=>{
    expect(proposeOwnerAction(question,data,'en')).toBeNull();
  });
  it('keeps upgrades as independent detail instructions and clarifies ambiguous approvals',()=>{
    expect(proposeOwnerAction('打开发布页面',data,'zh-CN')!.proposals).toEqual([]);
    expect(proposeOwnerAction('approve the plan',data,'en')!.proposals).toEqual([]);
  });
  it('routes resource rejection independently of plan rejection and keeps exact request bindings',()=>{
    const request={id:'resource:r1',type:'resource',summary:'Need dataset',actions:[{id:'reject:r1',requiresApproval:true,action:{type:'resource_reject',requestId:'r1',planId:'p1',revision:2,resource:'dataset:sales',note:'Owner'}}]};
    const resources={...data,inbox:[request]} as OwnerOverview;
    for(const q of ['拒绝资源 r1','reject resource r1','这个数据以后再提供'])expect(proposeOwnerAction(q,resources,'en')!.proposals[0]!.action).toMatchObject({type:'resource_reject',requestId:'r1',planId:'p1',revision:2});
    expect(proposeOwnerAction('open qj-a details',data,'en')!.proposals[0]).toMatchObject({risk:'read',requiresApproval:false,action:{type:'open_details',href:'/QIAN?qianji=qj-a'}});
  });
});
