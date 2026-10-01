import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BusinessHome } from '../src/features/business/BusinessHome';
import { readTable } from '../src/features/business/read_table';
import { businessDecision } from '../src/features/business/business_api';
import { lifeFixture } from './life_fixture';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('business owner journey', () => {
  it('retains paid-decision identity after a lost response and a retry', async () => {
    sessionStorage.clear();
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValue({ ok: true, json: async () => ({ id: 'saved-plan' }) } as Response);
    const body = { feedback: '调整节奏', revision: 2 };
    await expect(businessDecision('business/plans/p1/revisions', body)).rejects.toThrow('lost response');
    await expect(businessDecision('business/plans/p1/revisions', body)).resolves.toEqual({ id: 'saved-plan' });
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(fetcher.mock.calls[1]?.[1]?.body);
    expect(sessionStorage.length).toBe(0);
  });
  it('shows scope, expiry and cost and submits exactly the displayed revision/hash', async () => {
    const p = { id: 'p1', revision: 3, hash: 'exact-visible-hash', state: 'AWAITING_APPROVAL', spentMicros: 100, reservedMicros: 0,
      plan: { title: '整理询盘', objective: '减少整理工作', audience: '客服', hypothesis: '缺失字段导致返工',
        metric: { name: '整理时间', baseline: '30分钟', target: '10分钟', evidence: '工时记录' }, stopCondition: '质量降低',
        budgetMicros: 1000000, expiresAt: Date.now() + 86400000, actions: [{ datasetId: 'inquiries', purpose: '检查字段' }], resources: [] } };
    const payload = { settings: { limit_micros: 1000000 }, modelConfigured: true, plans: [p], datasets: [], requests: [], unknownOperations: [], tasks: [], spentMicros: 100, reservedMicros: 0 };
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async url => ({ ok: true, json: async () => String(url).includes('/evolution/') ? lifeFixture() : payload } as Response));
    render(<BusinessHome />);
    fireEvent.click(screen.getByRole('button', { name: '经营', exact: true })); await screen.findByText('已确认费用');
    fireEvent.click(screen.getByRole('button', { name: '方案', exact: true }));
    expect(screen.getByText(/检查字段/)).toBeTruthy(); expect(screen.getByText(/工时记录/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '批准执行此版本' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/business/plans/p1/approve', expect.objectContaining({
      body: JSON.stringify({ revision: 3, hash: 'exact-visible-hash' }),
    })));
    expect(screen.queryByText('运行轮数')).toBeNull();
  });
  it('reads quoted CSV and preserves identifiers and formulas as data', () => {
    const rows = readTable('\uFEFF客户,编号,金额,备注\r\n"A,B",001,12.5,"第一行\n第二行"\r\nC,002,3,=SUM(A1:A2)', '询盘.csv');
    expect(rows).toEqual([{ 客户: 'A,B', 编号: '001', 金额: 12.5, 备注: '第一行\n第二行' }, { 客户: 'C', 编号: '002', 金额: 3, 备注: '=SUM(A1:A2)' }]);
    expect(() => readTable('a,a\n1,2', 'bad.csv')).toThrow('列名');
    expect(() => readTable('a,b\n1', 'bad.csv')).toThrow('列数');
    expect(() => readTable('a\n"unterminated', 'bad.csv')).toThrow('引号');
  });
});
