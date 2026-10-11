import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorldEngine } from '../src/features/engine/WorldEngine';
import { apiRequest } from '../src/api/client';
import { enableWorlds, selectedWorld, selectWorld } from '../src/api/worldScope';
import { WorldSummary } from '../src/features/qianji/WorldSummary';
import { setLanguage } from '../src/i18n';

vi.mock('../src/api/client', async original => ({ ...await original<typeof import('../src/api/client')>(), apiRequest: vi.fn() }));
vi.mock('../src/features/engine/EngineView', () => ({ EngineView: () => <p data-testid="engine-world">{selectedWorld()}</p> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); enableWorlds(false); selectWorld(null); window.history.replaceState(null, '', '/'); });

describe('World navigation', () => {
  it('clears a rejected gateway error after a corrected save and prevents duplicate submits', async () => {
    const refresh=vi.fn().mockResolvedValue(undefined);
    vi.mocked(apiRequest).mockImplementation(async (_url,options) => {
      if(!options?.method)return {mainnetAtomic:'0'};
      if(String(options.body).includes('bad'))throw new Error('GATEWAY_INVALID');
      return {};
    });
    render(<WorldSummary item={{world:{world_id:'world_a',status:'ACTIVE',gatewayRevision:1}} as any} onRefresh={refresh}/>);
    fireEvent.change(screen.getByLabelText('更换活跃入口 Pixel'),{target:{value:'bad'}});
    fireEvent.click(screen.getByRole('button',{name:'确认更换入口'})); await screen.findByRole('alert');
    fireEvent.change(screen.getByLabelText('更换活跃入口 Pixel'),{target:{value:'0_0_0'}});
    const button=screen.getByRole('button',{name:'确认更换入口'});fireEvent.click(button);fireEvent.click(button);
    await waitFor(()=>expect(refresh).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(vi.mocked(apiRequest).mock.calls.filter(([,options])=>options?.method==='PUT')).toHaveLength(2);
  });
  it('follows browser history between Worlds instead of keeping the previous runtime selected', async () => {
    enableWorlds(true); window.history.replaceState(null, '', '/YUAN?world=world_a');
    vi.mocked(apiRequest).mockResolvedValue({ items: [
      { world_id: 'world_a', qianji_id: 'Alpha', status: 'ACTIVE' }, { world_id: 'world_b', qianji_id: 'Beta', status: 'ACTIVE' },
    ] });
    render(<WorldEngine onBack={() => {}} />);
    expect((await screen.findByTestId('engine-world')).textContent).toBe('world_a');
    await act(async () => { window.history.pushState(null, '', '/YUAN?world=world_b'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(screen.getByTestId('engine-world').textContent).toBe('world_b'); expect(selectedWorld()).toBe('world_b');
    await act(async () => { window.history.replaceState(null, '', '/YUAN'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(screen.queryByTestId('engine-world')).toBeNull(); expect(selectedWorld()).toBeNull();
  });
  it.each(['en', 'zh-CN'] as const)('keeps archived World history without offering invalid runtime actions in %s', async lang => {
    setLanguage(lang); vi.mocked(apiRequest).mockResolvedValue({ mainnetAtomic: '0' });
    render(<WorldSummary item={{ world: { world_id: 'archived', status: 'ARCHIVED' } } as any} onRefresh={vi.fn()} />);
    await screen.findByText(/0\.000000\s+USDT/);
    expect(screen.queryByRole('link')).toBeNull(); expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(lang === 'en' ? 'This World is archived. Its person and history remain available.' : '此 World 已归档，仅保留人物与历史记录。')).toBeTruthy();
  });
});
