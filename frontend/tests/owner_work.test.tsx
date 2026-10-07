import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {OwnerWork} from '../src/features/owner/OwnerWork';
import {OwnerChat} from '../src/features/owner/OwnerChat';
import {OwnerActionCard} from '../src/features/owner/OwnerActionCard';
import {setLanguage} from '../src/i18n';
import type {OwnerWork as Work} from '../../packages/protocol/src/types/owner';

beforeEach(()=>{localStorage.clear();setLanguage('en');});afterEach(()=>{cleanup();vi.restoreAllMocks();});
const work:Work={tasks:[{id:'task1',personId:'qj_a',personName:'一苇',instruction:'Inspect source and report',state:'REPLIED',turnId:'turn1',runId:'run1',reply:'# Actual result\n\n**Source read**.',reason:null,createdAt:1,updatedAt:2}],requests:[],codeReports:[]};
const response=(data:unknown)=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
describe('Owner execution evidence UI',()=>{
  it('shows actual task state and Markdown results in both languages, without labelling a reply as completed',()=>{
    render(<OwnerWork work={work}/>);expect(screen.getByText('一苇 · Person replied')).toBeTruthy();expect(screen.getByRole('heading',{name:'Actual result'})).toBeTruthy();
    act(()=>setLanguage('zh-CN'));expect(screen.getByText('一苇 · 人物已回复')).toBeTruthy();expect(screen.getByRole('heading',{name:'已派工作与人物回复'})).toBeTruthy();
  });
  it('requires recruitment approval and shows the role, rationale and initial task in both languages',()=>{
    const fetch=vi.spyOn(globalThis,'fetch');render(<OwnerActionCard proposal={{id:'r1',requiresApproval:true,action:{type:'recruit_approve',requestId:'hire1',hash:'a'.repeat(64),role:'Designer',reason:'Needs expertise',instruction:'Produce artwork'}}}/>);
    expect((screen.getByRole('button',{name:'Confirm action'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.getByText('Role: Designer')).toBeTruthy();expect(fetch).not.toHaveBeenCalled();
    act(()=>setLanguage('zh-CN'));expect(screen.getByText('职责: Designer')).toBeTruthy();expect(screen.getByText('批准招聘')).toBeTruthy();
  });
  it('retains the exact request and language for retries and after a browser reload',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce(response({answer:'Task queued',sources:[],as_of:new Date().toISOString(),usage:{tokens:0,cost_cny:0}}));
    const first=render(<OwnerChat missionControl/>);fireEvent.change(screen.getByLabelText('Ask the Owner assistant'),{target:{value:'Do the architecture work'}});await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Send'})));
    const payload=JSON.parse(String(fetch.mock.calls[0][1]!.body));expect(localStorage.getItem('emergentinc.ownerChat.pending')).toContain(payload.requestKey);first.unmount();setLanguage('zh-CN');render(<OwnerChat missionControl/>);
    expect((screen.getByLabelText('向老板窗口提问') as HTMLTextAreaElement).value).toBe('Do the architecture work');await act(async()=>fireEvent.click(screen.getByRole('button',{name:'发送'})));
    expect(JSON.parse(String(fetch.mock.calls[1][1]!.body))).toEqual(payload);expect(localStorage.getItem('emergentinc.ownerChat.pending')).toBeNull();
  });
});
