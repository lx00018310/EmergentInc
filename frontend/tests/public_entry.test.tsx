import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QianjiCard } from '../src/features/qianji/QianjiCard';
import { Entry } from '../src/Entry';
import { en } from '../src/i18n/en';
import { zhCN } from '../src/i18n/zh-CN';
import { setLanguage, t } from '../src/i18n';
import { displayRunStatus } from '../src/features/run/runStatusLabels';

vi.mock('../src/OwnerEntry', () => ({ OwnerEntry: () => <h1>{t('登录元胞会社')}</h1> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });
describe('V24 public and bilingual entry', () => {
  it('opens the public site without requesting an Owner session, defaults to English and retains language after remount', async () => {
    localStorage.removeItem('emergentinc.language');
    window.history.replaceState(null, '', '/');
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => ({ ok: true, json: async () => String(input).endsWith('/site') ? {
      site_name: 'EmergentInc', headline_en: 'AI that helps anyone start and run an online business.', headline_zh: '利用 AI 开启线上生意',
      description_en: 'Start with an idea.', description_zh: '从想法开始', github_url: 'https://github.com/lx00018310/EmergentInc', contact_text_en: 'Contact', contact_text_zh: '联系',
    } : { items: [] } }) as Response);
    const view = render(<Entry />);
    expect(await screen.findByRole('heading', { name: 'AI that helps anyone start and run an online business.' })).toBeTruthy();
    expect(fetch.mock.calls.every(([input]) => String(input).startsWith('/api/public/'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '中文' }));
    expect(await screen.findByRole('heading', { name: '利用 AI 开启线上生意' })).toBeTruthy();
    expect(localStorage.getItem('emergentinc.language')).toBe('zh-CN');
    view.unmount(); render(<Entry />);
    expect(await screen.findByRole('heading', { name: '利用 AI 开启线上生意' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(await screen.findByRole('heading', { name: 'AI that helps anyone start and run an online business.' })).toBeTruthy();
  });
  it.each(['/GENE', '/QIAN', '/YUAN'])('switches language at Owner entry %s', async path => {
    window.history.replaceState(null, '', path); localStorage.removeItem('emergentinc.language');
    render(<Entry />);
    expect(screen.getByRole('heading', { name: 'Log in to EmergentInc' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '中文' }));
    expect(screen.getByRole('heading', { name: '登录元胞会社' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByRole('heading', { name: 'Log in to EmergentInc' })).toBeTruthy();
  });
  it('keeps dictionary coverage identical and resolves module-level and nested World labels at the selected language', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort());
    setLanguage('en'); expect(displayRunStatus('STOPPED')).toBe('Stopped');
    setLanguage('zh-CN'); expect(displayRunStatus('STOPPED')).toBe('已停止');
    expect(t('An actual customer requirement')).toBe('An actual customer requirement');
    expect(t('{0} is actual customer text')).toBe('{0} is actual customer text');
    setLanguage('en');
    render(<QianjiCard selected={false} onSelect={() => {}} item={{ profile: { qianjiId: 'test', narrative: { displayName: 'Atlas' }, careerStatus: 'active', createdAt: 1 }, world: { status: 'ACTIVE', activePixels: 1 } } as any} />);
    expect(screen.getByText(/● World active/)).toBeTruthy();
    act(() => setLanguage('zh-CN'));
    expect(screen.getByText(/● World 活跃/)).toBeTruthy();
  });
});
