import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PixelSummaryDto } from '../api/types';

export function usePixelTips(pixels: PixelSummaryDto[] | undefined, worldId: string | null) {
  const [readRevision, setReadRevision] = useState(0);
  const readKey = useCallback((pixelId: string) =>
    `emergentinc.tips.read.${worldId ? worldId + '.' : ''}${pixelId}`, [worldId]);
  const isTipsUnread = useCallback((pixel: { id: string; tips_md?: string; tips_version?: string }) =>
    Boolean((pixel.tips_md ?? '').trim() && localStorage.getItem(readKey(pixel.id)) !== String(pixel.tips_version ?? '')),
    [readKey]);
  const markTipsRead = useCallback((pixel: { id: string; tips_version?: string }) => {
    localStorage.setItem(readKey(pixel.id), String(pixel.tips_version ?? ''));
    setReadRevision(value => value + 1);
  }, [readKey]);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith('emergentinc.tips.read.')) setReadRevision(value => value + 1);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const unreadTipsPixelIds = useMemo(() =>
    new Set((pixels ?? []).filter(isTipsUnread).map(pixel => pixel.id)), [pixels, isTipsUnread, readRevision]);
  return { isTipsUnread, markTipsRead, unreadTipsPixelIds };
}
