import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BossPluginCards } from '../src/features/boss/BossPluginCards';
import { setLanguage } from '../src/i18n';

const card = (extra: Record<string, unknown> = {}) => ({
  id: '001', pluginId: 'marketing', viewKey: 'marketing-summary', title: 'Marketing summary', titleZh: '营销摘要',
  visible: true, enabled: true, activeHash: 'a'.repeat(64), previousHash: null, revision: 1, incompatible: false,
  assetsUrl: '/api/owner/plugins/marketing/versions/' + 'a'.repeat(64) + '/assets/cards/marketing-summary/card.html',
  detailUrl: '/api/owner/plugins/marketing/versions/' + 'a'.repeat(64) + '/assets/cards/marketing-summary/detail.html',
  updatedAt: 1, ...extra,
});
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => setLanguage('en'));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('shows an empty company with the waiting message and no preset number', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ items: [] }));
  render(<BossPluginCards />);
  await screen.findByText('Waiting for the boss to develop cards.');
  expect(screen.queryByText('#001')).toBeNull();
});

it('renders visible cards with a sandboxed iframe and a hidden library only when needed', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ items: [card(), card({ id: '002', title: 'News brief', titleZh: '新闻简报', visible: false, assetsUrl: null, detailUrl: null })] }));
  render(<BossPluginCards />);
  await screen.findByText(/(?:Card|卡片) 001/);
  const frame = screen.getByTitle(/(?:Card|卡片) 001 card/);
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  expect(frame.getAttribute('src')).toContain('/api/owner/plugins/marketing/versions/');
  expect(screen.getByText(/#002/).closest('details')).toBeTruthy();
  expect(screen.queryByText('Show card')).toBeTruthy();
});

it.each(['en', 'zh-CN'] as const)('hides a visible card through the actions API in %s', async language => {
  setLanguage(language);
  const posts: RequestInit[] = []; let acted = false;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    if (init?.method === 'POST') { posts.push(init!); acted = true; return response({ ...card(), visible: false }); }
    return response({ items: acted ? [] : [card()] });
  });
  render(<BossPluginCards />);
  await screen.findByText(/(?:Card|卡片) 001/);
  fireEvent.click(screen.getByLabelText(language === 'en' ? 'Card options' : '卡片管理'));
  fireEvent.click(screen.getByRole('button', { name: language === 'en' ? 'Hide card' : '隐藏卡片' }));
  await waitFor(() => expect(posts).toHaveLength(1));
  const body = JSON.parse(String(posts[0].body));
  expect(body).toMatchObject({ action: 'hide', expectedRevision: 1 });
  expect(body.idempotencyKey).toBeTruthy();
});

it.each(['en', 'zh-CN'] as const)('opens the AI-generated detail view and returns without losing state in %s', async language => {
  setLanguage(language);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ items: [card()] }));
  render(<BossPluginCards />);
  await screen.findByText(/(?:Card|卡片) 001/);
  const preview = screen.getByTitle(/(?:Card|卡片) 001 card/);
  fireEvent.click(screen.getByRole('button', { name: language === 'en' ? 'Open Marketing summary' : '打开：营销摘要' }));
  await within(screen.getByRole('dialog')).findByRole('heading', { name: language === 'en' ? 'Marketing summary' : '营销摘要' });
  expect(screen.getByTitle(/(?:Card|卡片) 001 detail/).getAttribute('sandbox')).toBe('allow-scripts');
  fireEvent.click(screen.getByRole('button', { name: language === 'en' ? /Back to cards/ : /返回卡片/ }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByTitle(/(?:Card|卡片) 001 card/)).toBe(preview);
});

it('marks an incompatible card as disabled instead of rendering it', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ items: [card({ incompatible: true, enabled: false, assetsUrl: null, detailUrl: null })] }));
  render(<BossPluginCards />);
  await screen.findByText('The current host is incompatible with this card version. The card is disabled; its code and data are retained.');
});

it('bridges only GET_DATA requests from the exact sandbox frame and forwards server data back', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    if (init?.method === 'POST') {
      expect(JSON.parse(String(init.body))).toMatchObject({ resource: 'company.summary@1', cardId: '001', nonce: expect.any(String) });
      return response({ resource: 'company.summary@1', summary: { activeGoals: 2 } });
    }
    return response({ items: [card()] });
  });
  render(<BossPluginCards />);
  await screen.findByText(/(?:Card|卡片) 001/);
  const frame = screen.getByTitle(/(?:Card|卡片) 001 card/) as HTMLIFrameElement;
  const target = { postMessage: vi.fn(), closed: false } as unknown as Window;
  Object.defineProperty(frame, 'contentWindow', { value: target, configurable: true });
  window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { bridge: 'wrong-nonce', requestId: 'r1', kind: 'GET_DATA', resource: 'company.summary@1' } }));
  expect(target.postMessage).not.toHaveBeenCalled();
  const nonce = new URLSearchParams(new URL(frame.src).hash.slice(1)).get('bridge');
  window.dispatchEvent(new MessageEvent('message', { source: window, data: { bridge: nonce, requestId: 'r1', kind: 'GET_DATA', resource: 'company.summary@1' } }));
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { bridge: nonce, requestId: 'r1', kind: 'GET_DATA', resource: 'company.summary@1' } }));
  await waitFor(() => expect(target.postMessage).toHaveBeenCalledWith(expect.objectContaining({ bridge: nonce, kind: 'DATA', data: { resource: 'company.summary@1', summary: { activeGoals: 2 } } }), '*'));
});

it('passes the selected language to plugin pages and keeps the same color when language changes', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ items: [card()] }));
  render(<BossPluginCards />);
  const title = await screen.findByRole('heading', { name: 'Marketing summary' });
  const color = title.closest('article')!.getAttribute('style');
  expect(screen.getByTitle('Card 001 card').getAttribute('src')).toContain('language=en');
  act(() => setLanguage('zh-CN'));
  expect(screen.getByRole('heading', { name: '营销摘要' }).closest('article')!.getAttribute('style')).toBe(color);
  expect(screen.getByTitle('卡片 001 card').getAttribute('src')).toContain('language=zh-CN');
  expect(screen.queryByRole('heading', { name: 'Marketing summary' })).toBeNull();
});

it('resizes only the matching preview frame with its nonce', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ items: [card()] }));
  render(<BossPluginCards />);
  const frame = await screen.findByTitle('Card 001 card') as HTMLIFrameElement;
  const nonce = new URLSearchParams(new URL(frame.src).hash.slice(1)).get('bridge');
  act(() => window.dispatchEvent(new MessageEvent('message', { source: window, data: { bridge: nonce, kind: 'RESIZE', height: 500 } })));
  expect(frame.style.height).toBe('200px');
  act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { bridge: nonce, kind: 'RESIZE', height: 500 } })));
  expect(frame.style.height).toBe('500px');
});
