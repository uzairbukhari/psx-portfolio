import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { pct, signedPkr } from '@/lib/format';

/**
 * Gain or loss that never relies on colour alone: an explicit +/− sign and an arrow
 * accompany the success/danger token colour. Null renders an em dash (unknown, not zero).
 */
export function GainText({
  value,
  percent,
  unknownLabel = '—',
}: {
  value: number | null | undefined;
  percent?: number | null;
  unknownLabel?: string;
}) {
  if (value === null || value === undefined)
    return <span className="gain-unknown">{unknownLabel}</span>;
  const tone = value > 0 ? 'pos-text' : value < 0 ? 'neg-text' : 'flat-text';
  const Arrow = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : null;
  return (
    <span className={`gain-text ${tone}`}>
      {Arrow && <Arrow size={14} aria-hidden="true" />}
      <span>{signedPkr(value)}</span>
      {percent !== null && percent !== undefined && (
        <small className="gain-percent">({pct(percent, { sign: true })})</small>
      )}
    </span>
  );
}
