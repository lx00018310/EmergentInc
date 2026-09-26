import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiMocks = vi.hoisted(() => ({
  listMissions: vi.fn(async () => [{ missionId: 'mission-a', title: 'Accepted work', missionType: 'research', objective: 'Write a report', acceptanceCriteria: 'Owner accepts', budgetTokens: 1000, roundsLimit: 1, deadlineRound: null, status: 'completed', ownerQianjiId: 'qj-a', acceptanceNote: 'Accepted', createdAt: 1, completedAt: 2, executionId: 'execution-a', participants: [{ qianjiId: 'qj-a', bindingId: 'binding-a', duty: 'Research' }] }]),
  listTrials: vi.fn(async () => []), listProducts: vi.fn(async () => [{ productId: 'product-a', name: 'Sample product', description: 'A test product', targetUser: 'Readers', problemStatement: 'Need concise reports', ownerQianjiId: 'qj-a', status: 'live', previousStatus: null, retirementReason: null, createdAt: 1, missions: ['mission-a'] }]),
  listRevenues: vi.fn(async () => [{ externalTxId: 'external-1', amountFen: 5000, currency: 'CNY', productId: 'product-a', missionId: 'mission-a', primaryQianjiId: 'qj-a', evidenceRef: 'receipt-1', recordSource: 'owner_confirmed', refundFen: 0, verified: true, contributions: [{ qianjiId: 'qj-a', shareBps: 10000 }] }]),
  listRecruitments: vi.fn(async () => []), listNarrativeArtifacts: vi.fn(async () => []), listFeedback: vi.fn(async () => []), listDeliveries: vi.fn(async () => []),
  businessMetrics: vi.fn(async (scope = 'organization', id?: string) => ({ scope, id, knownCostCny: 2, totalCostCny: 2, unknownModelCount: 0, unknownToolCount: 0, confirmedRevenueFen: 5000, refundFen: 0, netRevenueFen: 5000, roi: 24 })),
  createMission: vi.fn(async (body: unknown) => body),
  createTrial: vi.fn(async (_body: unknown) => ({ trialId: 'trial-new' })),
  createRevenue: vi.fn(async (body: unknown) => body), createRefund: vi.fn(async (_txId: string, body: unknown) => body),
}));

const qianjiMocks = vi.hoisted(() => ({
  fetchQianjiList: vi.fn(async (_signal?: AbortSignal, status?: string) => status === 'retired' ? [] : [{
    profile: { qianjiId: 'qj-a', careerStatus: 'active', narrative: { displayName: 'Researcher', title: null, roleLabel: null, traits: {}, behaviorProfile: [], flaw: null, shortBio: null, appearanceSpec: null, portraitAsset: null, contentRevision: 0 }, narrativeRevision: 0, createdAt: 1, retiredAt: null, retiredReason: null },
    currentBinding: { bindingId: 'binding-a', qianjiId: 'qj-a', pixelId: '0_0_0', incarnation: 1, boundAt: 1, unboundAt: null, birthEffectId: null, archiveRelativePath: null },
    bindingHistory: [], physical: { accountExists: true, active: true, energy: 1000, refundDeficitTokens: 0, stateIncarnation: 1, bindingConsistent: true },
  }, {
    profile: { qianjiId: 'qj-b', careerStatus: 'active', narrative: { displayName: 'Collaborator', title: null, roleLabel: null, traits: {}, behaviorProfile: [], flaw: null, shortBio: null, appearanceSpec: null, portraitAsset: null, contentRevision: 0 }, narrativeRevision: 0, createdAt: 1, retiredAt: null, retiredReason: null },
    currentBinding: { bindingId: 'binding-b', qianjiId: 'qj-b', pixelId: '1_0_0', incarnation: 1, boundAt: 1, unboundAt: null, birthEffectId: null, archiveRelativePath: null },
    bindingHistory: [], physical: { accountExists: true, active: true, energy: 1000, refundDeficitTokens: 0, stateIncarnation: 1, bindingConsistent: true },
  }]),
  fetchQianjiHistory: vi.fn(), qianjiArtifactUrl: vi.fn(),
}));

vi.mock('../src/api/organization', () => apiMocks);
vi.mock('../src/api/qianji', () => qianjiMocks);
import { OrganizationDesk } from '../src/features/organization/OrganizationDesk';

describe('OrganizationDesk product accounting inputs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.listRecruitments.mockResolvedValue([]);
    vi.spyOn(window, 'setInterval').mockReturnValue(1);
  });
  afterEach(() => vi.restoreAllMocks());

  it('requires a known recruitment before creating a trial', async () => {
    apiMocks.listRecruitments.mockResolvedValue([{ recruitmentId: 'recruitment-a', roleLabel: '研究招贤榜' }] as any);
    render(<OrganizationDesk onBack={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: '招贤与试炼' }));
    await screen.findByRole('option', { name: '研究招贤榜' });
    const submit = screen.getByRole('button', { name: '创建试炼' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.submit(submit.closest('form')!);
    expect(apiMocks.createTrial).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('统一考题'), { target: { value: '研究题目' } });
    fireEvent.change(screen.getByLabelText('统一验收标准'), { target: { value: '来源明确' } });
    fireEvent.change(screen.getByLabelText('招贤榜'), { target: { value: 'recruitment-a' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(apiMocks.createTrial).toHaveBeenCalledWith(expect.objectContaining({ recruitmentId: 'recruitment-a' })));
  });

  it('asks for a recruitment first when none exist', async () => {
    render(<OrganizationDesk onBack={() => undefined} />);
    await screen.findByText('Accepted work');
    fireEvent.click(screen.getByRole('button', { name: '招贤与试炼' }));
    expect(screen.getByText('请先发布招贤榜，再创建关联试炼。')).toBeTruthy();
    expect((screen.getByRole('button', { name: '创建试炼' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('loads product-scoped figures and records the supplied external receipt and refund evidence', async () => {
    render(<OrganizationDesk onBack={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: '产品与商业' }));
    await waitFor(() => expect(apiMocks.businessMetrics).toHaveBeenCalledWith('product', 'product-a'));
    expect(screen.getByText(/关联 Mission 成本 2\.0000 CNY/)).toBeTruthy();
    expect(screen.getByText(/确认收款 5,000 分/)).toBeTruthy();
    expect(screen.getByText(/Owner确认；来源 owner_confirmed；凭据 receipt-1/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('完成 Mission'), { target: { value: 'mission-a' } });
    fireEvent.change(screen.getByLabelText('外部交易编号'), { target: { value: 'bank-reference-42' } });
    fireEvent.change(screen.getByLabelText('确认收款（分）'), { target: { value: '2500' } });
    fireEvent.change(screen.getByLabelText('本地凭据索引'), { target: { value: 'receipt-file-42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Owner 确认已收款' }));
    await waitFor(() => expect(apiMocks.createRevenue).toHaveBeenCalledWith(expect.objectContaining({
      externalTxId: 'bank-reference-42', amountFen: 2500, productId: 'product-a', missionId: 'mission-a',
      primaryQianjiId: 'qj-a', evidenceRef: 'receipt-file-42',
    })));

    fireEvent.change(screen.getByLabelText('external-1 退款原因'), { target: { value: 'Partial return' } });
    fireEvent.change(screen.getByLabelText('external-1 退款凭据索引'), { target: { value: 'refund-file-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Owner 记录退款' }));
    await waitFor(() => expect(apiMocks.createRefund).toHaveBeenCalledWith('external-1', expect.objectContaining({
      reason: 'Partial return', evidenceRef: 'refund-file-1', amountFen: 1,
    })));
  });

  it('keeps incomplete cost and ROI visibly unknown', async () => {
    apiMocks.businessMetrics.mockResolvedValueOnce({ scope: 'product', id: 'product-a', knownCostCny: 0, totalCostCny: null,
      unknownModelCount: 1, unknownToolCount: 0, confirmedRevenueFen: 0, refundFen: 0, netRevenueFen: 0, roi: null } as any);
    render(<OrganizationDesk onBack={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: '产品与商业' }));
    await waitFor(() => expect(apiMocks.businessMetrics).toHaveBeenCalledWith('product', 'product-a'));
    expect(screen.getByText(/完整成本未知/)).toBeTruthy();
    expect(screen.getByText(/ROI 未知/)).toBeTruthy();
  });

  it('includes selected active Qianji participants in a new Mission draft', async () => {
    render(<OrganizationDesk onBack={() => undefined} />);
    fireEvent.click(await screen.findByLabelText('Collaborator'));
    await waitFor(() => expect((screen.getByLabelText('Researcher') as HTMLInputElement).checked).toBe(true));
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Shared Mission' } });
    fireEvent.change(screen.getByLabelText('目标'), { target: { value: 'Prepare one report' } });
    fireEvent.change(screen.getByLabelText('验收标准'), { target: { value: 'Owner reviews it' } });
    fireEvent.click(screen.getByRole('button', { name: '创建 draft' }));
    await waitFor(() => expect(apiMocks.createMission).toHaveBeenCalledWith(expect.objectContaining({
      ownerQianjiId: 'qj-a',
      participants: [
        { qianjiId: 'qj-a', bindingId: 'binding-a', duty: '' },
        { qianjiId: 'qj-b', bindingId: 'binding-b', duty: '' },
      ],
    })));
  });
});
