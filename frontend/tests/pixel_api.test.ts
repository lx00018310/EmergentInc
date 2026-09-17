import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMandate, updateMandate, deleteMandate, postExternalReward, fetchExternalRewards, fetchStepCosts } from '../src/api/pixels';

afterEach(() => vi.unstubAllGlobals());

describe('V11 pixel API contracts', () => {
  it('reuses existing mandate/reward routes and agreed read-only ledger routes', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({}) });
    vi.stubGlobal('fetch', fetch);
    const id = 'pixel #1';
    await fetchMandate(id);
    await updateMandate(id, 'mandate only');
    await deleteMandate(id);
    await postExternalReward(id, { amount: 7, source: 'human', reason: 'accepted' });
    await fetchExternalRewards(id);
    await fetchStepCosts(id);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/pixels/pixel%20%231/mandate', '/api/pixels/pixel%20%231/mandate', '/api/pixels/pixel%20%231/mandate',
      '/api/pixels/pixel%20%231/reward', '/api/pixels/pixel%20%231/rewards', '/api/pixels/pixel%20%231/step-costs',
    ]);
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ mandate: 'mandate only' }) });
    expect(fetch.mock.calls[2][1]).toMatchObject({ method: 'DELETE' });
    expect(fetch.mock.calls[3][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ amount: 7, source: 'human', reason: 'accepted' }) });
    expect(fetch.mock.calls[4][1].method).toBeUndefined();
    expect(fetch.mock.calls[5][1].method).toBeUndefined();
  });
});
