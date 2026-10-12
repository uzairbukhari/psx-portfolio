// A row of summary figures. On phones: two per row, the odd last card spans both columns, and one figure can be
// marked primary so the eye has somewhere to land instead of five equal numbers.
import { cn } from '@/lib/utils';

export type Kpi = {
  label: string;
  value: string;
  note?: string;
  tone?: 'pos' | 'neg';
  /** The one figure to read first. */
  primary?: boolean;
};

export function KpiStrip({ items, className }: { items: Kpi[]; className?: string }) {
  return (
    <dl
      className={cn(
        'mb-4 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-flow-col lg:auto-cols-fr lg:grid-cols-none',
        className,
      )}
    >
      {items.map((k, i) => (
        <div
          key={k.label}
          className={cn(
            'min-w-0 rounded-xl border border-border bg-card px-3.5 py-3 sm:px-4 sm:py-3.5',
            items.length % 2 === 1 && i === items.length - 1 && 'col-span-2 lg:col-span-1',
            k.primary && 'border-primary/25 bg-primary/5',
          )}
        >
          <dt className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
            {k.label}
          </dt>
          <dd
            className={cn(
              'mt-1 truncate font-semibold tracking-tight tabular-nums',
              k.primary ? 'text-xl sm:text-2xl' : 'text-lg sm:text-xl',
              k.tone === 'pos' && 'text-[var(--success)]',
              k.tone === 'neg' && 'text-[var(--danger)]',
            )}
            title={k.value}
          >
            {k.value}
          </dd>
          {k.note && <p className="mt-0.5 text-xs text-muted-foreground">{k.note}</p>}
        </div>
      ))}
    </dl>
  );
}
