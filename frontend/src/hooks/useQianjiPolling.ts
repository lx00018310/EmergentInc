import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchQianjiList, fetchWorldEvents, fetchWorldPresentation } from '../api/qianji';
import type { QianjiListItemDto, WorldEventDto, WorldPresentationDto } from '../api/qianji';

export function useQianjiPolling() {
  const [items, setItems] = useState<QianjiListItemDto[]>([]);
  const [events, setEvents] = useState<WorldEventDto[]>([]);
  const [presentation, setPresentation] = useState<WorldPresentationDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);

  const refresh = useCallback(async () => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    try {
      const [nextItems, nextEvents, nextPresentation] = await Promise.all([
        fetchQianjiList(next.signal), fetchWorldEvents(next.signal), fetchWorldPresentation(next.signal),
      ]);
      if (!mounted.current) return;
      setItems(nextItems);
      setEvents(nextEvents);
      setPresentation(nextPresentation);
      setError(null);
    } catch (err) {
      if (!mounted.current || (err instanceof DOMException && err.name === 'AbortError')) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const poll = () => {
      timer.current = setTimeout(async () => {
        await refresh();
        if (mounted.current) poll();
      }, 5000);
    };
    poll();
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      controller.current?.abort();
    };
  }, [refresh]);

  return { items, events, presentation, error, loading, refresh };
}
