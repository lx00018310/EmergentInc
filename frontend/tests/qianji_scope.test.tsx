import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QianJiHall } from '../src/features/hall/QianJiHall';
import { enableWorlds, selectWorld } from '../src/api/worldScope';
import { setLanguage } from '../src/i18n';

const members = ['Alpha', 'Beta'].map(name => ({
  profile: { qianjiId: name, careerStatus: 'active', narrativeRevision: 0, createdAt: 1,
    narrative: { displayName: name, title: null, roleLabel: null, traits: {}, behaviorProfile: [], portraitAsset: null } },
  currentBinding: { pixelId: '0_0_0', bindingId: name, incarnation: 1 },
  physical: { active: true, energy: 1000, refundDeficitTokens: 0 }, bindingHistory: [],
}));
vi.mock('../src/hooks/useWorldPolling', () => ({ useWorldPolling: () => ({ world: null, worldId: null, runStatus: null, refreshImmediately: vi.fn() }) }));
vi.mock('../src/hooks/useQianjiPolling', () => ({ useQianjiPolling: () => ({ items: members, loading: false, refresh: vi.fn(), presentation: null }) }));
vi.mock('../src/api/meetings', () => ({ listApprovals: async () => [] }));
vi.mock('../src/api/qianji', async original => ({ ...await original<typeof import('../src/api/qianji')>(), fetchQianjiChat: async () => [] }));

function Hall() {
  const [selected, setSelected] = useState<string | null>('Alpha');
  return <QianJiHall selectedQianjiId={selected} onSelectedQianji={setSelected} onSelectedPixel={() => {}} onOpenEngine={() => {}} />;
}
beforeEach(() => { enableWorlds(false); selectWorld(null); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('QIAN person state isolation', () => {
  it.each(['en', 'zh-CN'] as const)('clears the previous recipient draft and closes their menu request in %s', async lang => {
    setLanguage(lang); render(<Hall />);
    const sendTo = lang === 'en' ? 'Send to Alpha' : '发送给 Alpha';
    const next = lang === 'en' ? 'Send to Beta' : '发送给 Beta';
    fireEvent.change(screen.getByLabelText(sendTo), { target: { value: 'For Alpha only' } });
    fireEvent.click(screen.getByText('Beta', { exact: true }));
    await waitFor(() => expect(screen.getByLabelText(next)).toHaveProperty('value', ''));
    fireEvent.click(screen.getByText('Alpha', { exact: true }));
    expect(screen.getByLabelText(sendTo)).toHaveProperty('value', '');
  });

  it('reopens the same profile menu action and does not carry it to another person', async () => {
    render(<Hall />);
    for (let i = 0; i < 2; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Alpha更多操作' }));
      fireEvent.click(screen.getByRole('menuitem', { name: '出生' }));
      expect(await screen.findByRole('heading', { name: '人设', exact: true })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: '关闭', exact: true }));
    }
    fireEvent.click(screen.getByText('Beta', { exact: true }));
    expect(screen.queryByRole('heading', { name: '人设', exact: true })).toBeNull();
  });
});
