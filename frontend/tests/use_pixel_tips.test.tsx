import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { usePixelTips } from '../src/hooks/usePixelTips';
import type { PixelSummaryDto } from '../src/api/types';

const pixels = [{ id: '0_0_0', tips_md: 'Review this result.', tips_version: 'v1' }] as PixelSummaryDto[];
beforeEach(() => localStorage.clear());

it('shares read versions between pages and isolates identical Pixel IDs in different Worlds', () => {
  const { result, rerender, unmount } = renderHook(({ worldId }) => usePixelTips(pixels, worldId), { initialProps: { worldId: 'world_a' } });
  act(() => result.current.markTipsRead(pixels[0]));
  expect(result.current.unreadTipsPixelIds.size).toBe(0);
  rerender({ worldId: 'world_b' });
  expect(result.current.unreadTipsPixelIds.has('0_0_0')).toBe(true);
  unmount();
  const otherPage = renderHook(() => usePixelTips(pixels, 'world_a'));
  expect(otherPage.result.current.unreadTipsPixelIds.size).toBe(0);
});

it('updates the unread indicator when another browser tab marks the version read', () => {
  const { result } = renderHook(() => usePixelTips(pixels, 'world_a'));
  expect(result.current.unreadTipsPixelIds.has('0_0_0')).toBe(true);
  act(() => {
    localStorage.setItem('emergentinc.tips.read.world_a.0_0_0', 'v1');
    window.dispatchEvent(new StorageEvent('storage', { key: 'emergentinc.tips.read.world_a.0_0_0' }));
  });
  expect(result.current.unreadTipsPixelIds.size).toBe(0);
});
