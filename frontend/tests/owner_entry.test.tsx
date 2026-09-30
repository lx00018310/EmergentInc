import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { OwnerEntry } from '../src/OwnerEntry';

vi.mock('../src/App', () => ({ App: () => <h1>人物与元胞界面</h1> }));
vi.mock('../src/features/business/BusinessHome', () => ({ BusinessHome: () => <h1>完整经营工作台</h1> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });
describe('product URL ownership', () => {
  it.each(['/','/QIAN','/YUAN'])('shows Body at %s even when the server runs business mode', async path => {
    window.history.replaceState(null, '', path);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ authenticated: true, mode: 'business' }) } as Response);
    render(<OwnerEntry />);
    expect(await screen.findByRole('heading', { name: '人物与元胞界面' })).toBeTruthy();
    expect(screen.queryByText('完整经营工作台')).toBeNull();
  });
  it.each(['/GENE','/gene/'])('shows the complete workbench only at %s', async path => {
    window.history.replaceState(null, '', path);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ authenticated: true, mode: 'business' }) } as Response);
    render(<OwnerEntry />);
    expect(await screen.findByRole('heading', { name: '完整经营工作台' })).toBeTruthy();
    expect(window.location.pathname).toBe('/GENE');
    expect(screen.queryByText('人物与元胞界面')).toBeNull();
  });
  it('keeps the selected Gene URL through login', async () => {
    window.history.replaceState(null, '', '/GENE');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: false, mode: 'business' }) } as Response)
      .mockResolvedValue({ ok: true, json: async () => ({ authenticated: true, mode: 'business' }) } as Response);
    render(<OwnerEntry />);
    expect(await screen.findByRole('heading', { name: '登录经营工作台' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Owner 口令'), { target: { value: 'test-owner-secret' } });
    await screen.findByRole('button', { name: '登录' });
    fireEvent.submit(screen.getByRole('button', { name: '登录' }).closest('form')!);
    expect(await screen.findByRole('heading', { name: '完整经营工作台' })).toBeTruthy();
    expect(window.location.pathname).toBe('/GENE');
  });
});
