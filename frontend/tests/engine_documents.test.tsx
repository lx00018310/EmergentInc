import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EngineView } from '../src/features/engine/EngineView';
import { fetchPixelDocument } from '../src/api/files';

vi.mock('../src/hooks/useWorldPolling', () => ({ useWorldPolling: () => ({ worldId: 'world_a', runStatus: null, audit: null, refreshImmediately: vi.fn(),
  world: { round: 0, metrics: { alive_pixels: 1, total_energy: 100 }, pixels: [{ id: '0_0_0', position: [0, 0, 0], active: true, energy: 100, neighbors: [], pixel_md: '', tips_md: '', artifacts_count: 0 }] } }) }));
vi.mock('../src/features/pixels/PixelMapCanvas', () => ({ PixelMapCanvas: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../src/features/owner/OwnerChat', () => ({ OwnerChat: () => null }));
vi.mock('../src/api/prompts', () => ({ fetchGenesisPrompt: async () => ({ content: '', revision: 0 }), fetchTemporaryPrompt: async () => ({ content: '', revision: 0 }) }));
vi.mock('../src/api/files', async original => ({ ...await original<typeof import('../src/api/files')>(), fetchPixelDocument: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('YUAN document tab responses', () => {
  it('keeps an initially selected Pixel closed after the Owner dismisses its detail card', async () => {
    render(<EngineView onBack={() => {}} initialPixelId="0_0_0" />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '关闭详情卡' })));
    expect(screen.queryByRole('button', { name: '查看文档' })).toBeNull();
  });
  it('ignores an earlier slow document after the user selects another tab', async () => {
    let finish!: (value: any) => void;
    vi.mocked(fetchPixelDocument).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce({ content: 'Current Tips document' } as any);
    render(<EngineView onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: '查看文档', exact: true }));
    fireEvent.click(screen.getByRole('tab', { name: 'tips.md' }));
    await screen.findByText('Current Tips document');
    await act(async () => finish({ content: 'Old Pixel document' }));
    expect(screen.getByText('Current Tips document')).toBeTruthy();
    expect(screen.queryByText('Old Pixel document')).toBeNull();
    expect(screen.getByRole('tab', { name: 'tips.md' }).getAttribute('aria-selected')).toBe('true');
  });
});
