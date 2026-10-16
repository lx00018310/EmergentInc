import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QianjiCard } from '../src/features/qianji/QianjiCard';
import { QianjiChatPanel } from '../src/features/qianji/QianjiChatPanel';
import { fetchQianjiChat } from '../src/api/qianji';

vi.mock('../src/api/qianji', async original => ({ ...await original<typeof import('../src/api/qianji')>(), fetchQianjiChat: vi.fn() }));
const item: any = { profile: {qianjiId:'qj_energy',careerStatus:'active',createdAt:1,narrative:{displayName:'入口'}},
  currentBinding:null,physical:{active:true,refundDeficitTokens:0},world:{world_id:'world_energy',status:'ACTIVE',gateway_pixel_id:'0_0_0',infiniteEnergy:false} };
beforeEach(() => vi.clearAllMocks());

it.each([['zh-CN','无限能量','入口更多操作'],['en','Unlimited energy','More actions for 入口']])('removes the individual energy setting in %s', (lang,label,menu) => {
  localStorage.setItem('emergentinc.language',lang);
  render(<QianjiCard item={item} selected onSelect={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:menu}));
  expect(screen.queryByRole('menuitemcheckbox',{name:label})).toBeNull();
});

it.each([
  ['zh-CN','历史个人额度等待；公司启动且总金额预算充足后由调度恢复。','存在未决调用，请进入 World 恢复处理后再运行。'],
  ['en','Old individual allowance wait. Company scheduling resumes when enabled and funded.','Unresolved calls require review in World recovery before running again.'],
])('shows the specific energy message without mislabeling other blocked states in %s', async (lang,energy,other) => {
  localStorage.setItem('emergentinc.language',lang);
  vi.mocked(fetchQianjiChat).mockResolvedValue([
    {turnId:'energy',question:'work',status:'blocked',blockReason:'WAITING_PIXEL_BUDGET',reply:null},
    {turnId:'unknown',question:'check',status:'blocked',blockReason:'CALL_OUTCOME_UNKNOWN',reply:null},
  ] as any);
  render(<QianjiChatPanel item={item} onSent={vi.fn()}/>);
  expect(await screen.findByText(energy)).toBeTruthy();
  expect(screen.getByText(other)).toBeTruthy();
});
