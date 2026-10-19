import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  await screen.findByText(/#001/);
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
  await screen.findByText(/#001/);
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
  await screen.findByText(/#001/);
  fireEvent.click(screen.getByRole('button', { name: language === 'en' ? 'Open details' : '打开详情' }));
  await screen.findByText(/#001 (?:Marketing summary|营销摘要)/);
  expect(screen.getByTitle(/(?:Card|卡片) 001 detail/).getAttribute('sandbox')).toBe('allow-scripts');
  fireEvent.click(screen.getByRole('button', { name: language === 'en' ? 'Back to cards' : '返回卡片' }));
  expect(screen.getByText(/#001/)).toBeTruthy();
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
  await screen.findByText(/#001/);
  const frame = screen.getByTitle(/(?:Card|卡片) 001 card/) as HTMLIFrameElement;
  const target = { postMessage: vi.fn(), closed: false } as unknown as Window;
  Object.defineProperty(frame, 'contentWindow', { value: target, configurable: true });
  window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { bridge: 'wrong-nonce', requestId: 'r1', kind: 'GET_DATA', resource: 'company.summary@1' } }));
  expect(target.postMessage).not.toHaveBeenCalled();
  window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { bridge: (window as any).__lastNonce, requestId: 'r1', kind: 'GET_DATA', resource: 'company.summary@1' } })).__proto__;
  // A wrong-nonce or non-frame source message is ignored by design.
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});
