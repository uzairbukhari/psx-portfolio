'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- the host of a canvas is described with role=img and a label, not an <img> */

import { useEffect, useRef, useState } from 'react';
import type { EChartsOption, ECharts } from 'echarts';
import { FALLBACK_TOKENS, readTokens, type ChartTokens } from '@/lib/chart-kit';

export type ChartPick = {
  name: string;
  seriesName?: string;
  dataIndex: number;
  value: unknown;
};

/**
 * One interactive chart. The charting library is imported the first time the chart scrolls into view, so it never
 * delays the first paint. Colours are read from the page's theme variables and the chart redraws when the theme changes.
 * `build` turns the resolved colours into an ECharts option (see lib/chart-kit.ts).
 */
export function EChart({
  build,
  label,
  height,
  onPick,
  className,
}: {
  build: (t: ChartTokens) => EChartsOption;
  /** Spoken summary of the chart, read instead of the canvas. */
  label: string;
  /** Pixels; leave out when the class sets the height. */
  height?: number;
  onPick?: (p: ChartPick) => void;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const pick = useRef(onPick);
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === 'undefined',
  );
  const [ready, setReady] = useState(false);
  const [tokens, setTokens] = useState<ChartTokens>(FALLBACK_TOKENS);

  // Wait until the chart is on screen.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (e) => {
        if (e.some((x) => x.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Theme: html[data-theme] (and the system colour scheme when it is "system").
  useEffect(() => {
    const bump = () => setTokens(readTokens(box.current ?? undefined));
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-chart-palette', 'class'],
    });
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', bump);
    return () => {
      mo.disconnect();
      mq?.removeEventListener?.('change', bump);
    };
  }, []);

  // Create the chart.
  useEffect(() => {
    if (!visible || !box.current) return;
    let dead = false;
    let ro: ResizeObserver | undefined;
    void import('./echarts-core').then(({ echarts }) => {
      if (dead || !box.current) return;
      const c = echarts.init(box.current, undefined, { renderer: 'canvas' });
      chart.current = c;
      c.on('click', (p) => {
        const e = p as {
          name?: string;
          seriesName?: string;
          dataIndex?: number;
          value?: unknown;
        };
        if (pick.current && e.name !== undefined)
          pick.current({
            name: e.name,
            seriesName: e.seriesName,
            dataIndex: e.dataIndex ?? 0,
            value: e.value,
          });
      });
      let raf = 0;
      ro = new ResizeObserver(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => c.resize());
      });
      ro.observe(box.current);
      setTokens(readTokens(box.current ?? undefined));
      setReady(true);
    });
    return () => {
      dead = true;
      ro?.disconnect();
      chart.current?.dispose();
      chart.current = null;
      setReady(false);
    };
  }, [visible]);

  // Parents re-render often; only redraw (which resets zoom) when the chart's content actually changes.
  const option = build(tokens);
  const sig = JSON.stringify(option, (_k, v) =>
    typeof v === 'function' ? 'fn' : v,
  );
  const latest = useRef({ option, onPick });
  useEffect(() => {
    latest.current = { option, onPick };
    pick.current = onPick;
  });
  useEffect(() => {
    if (!ready || !chart.current) return;
    // A malformed option must never take the page down; the chart just stays blank.
    try {
      chart.current.setOption(latest.current.option, { notMerge: true });
    } catch {
      chart.current.clear();
    }
  }, [ready, sig]);

  return (
    <div
      ref={box}
      role="img"
      aria-label={label}
      className={`echart${className ? ` ${className}` : ''}`}
      style={{
        height,
        width: '100%',
        minWidth: 0,
        cursor: onPick ? 'pointer' : undefined,
      }}
    />
  );
}
