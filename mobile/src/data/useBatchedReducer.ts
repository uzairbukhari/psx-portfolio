import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Like useReducer, but events are queued and applied in one setState at most every `intervalMs`. A burst of 40 SSE
 * quotes at the open becomes 4 renders a second instead of 40, and the reducer still sees every event in order.
 */
export function useBatchedReducer<S, E>(reduce: (state: S, event: E) => S, initial: S, intervalMs = 250) {
  const [state, setState] = useState(initial);
  const queue = useRef<E[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduceRef = useRef(reduce);
  useEffect(() => {
    reduceRef.current = reduce;
  }, [reduce]);

  const flush = useCallback(() => {
    timer.current = null;
    const events = queue.current;
    if (!events.length) return;
    queue.current = [];
    setState((s) => events.reduce(reduceRef.current, s));
  }, []);

  const push = useCallback(
    (event: E) => {
      queue.current.push(event);
      if (!timer.current) timer.current = setTimeout(flush, intervalMs);
    },
    [flush, intervalMs],
  );

  const reset = useCallback((next: S) => {
    queue.current = [];
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setState(next);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return [state, push, reset] as const;
}
