// What the admin Overview calls out: a merged, ordered list of things that need a look. Pure, so tests can check it.
import type { AdminHealth } from './admin-health.ts';
import type { OverviewMetrics } from './analytics-store.ts';

export type Attention = { level: 'failing' | 'late' | 'info'; section: 'health' | 'audit'; text: string };

const LEVEL = { failing: 0, late: 1, info: 2 } as const;
const hours = (min: number) => (min < 120 ? `${min} minutes` : min < 48 * 60 ? `${Math.round(min / 60)} hours` : `${Math.round(min / 1440)} days`);

export function buildAttention(health: AdminHealth, metrics: OverviewMetrics): Attention[] {
  const out: Attention[] = [];
  for (const p of health.pipelines) {
    if (p.status === 'failing') {
      out.push({ level: 'failing', section: 'health', text: p.lastSuccessAt
        ? `${p.label} has not succeeded for ${hours(p.ageMinutes ?? 0)} (${p.expected.toLowerCase()}).${p.lastError ? ` Last error: ${p.lastError}` : ''}`
        : `${p.label} has never succeeded.${p.lastError ? ` Last error: ${p.lastError}` : ''}` });
    } else if (p.status === 'late') {
      out.push({ level: 'late', section: 'health', text: `${p.label} is ${hours(p.ageMinutes ?? 0)} old (${p.expected.toLowerCase()}).${p.lastError ? ` Last error: ${p.lastError}` : ''}` });
    }
  }
  const q = health.queues;
  if (q.stuckCount > 0) out.push({ level: 'late', section: 'health', text: `${q.stuckCount} data request${q.stuckCount === 1 ? '' : 's'} queued over 15 minutes.` });
  if (health.unsettledFactsRequests > 0) out.push({ level: 'late', section: 'health', text: `${health.unsettledFactsRequests} company-data request(s) never finished.` });
  for (const s of health.aiSpend.sources) {
    if (s.capUsd && s.usd >= s.capUsd) out.push({ level: 'failing', section: 'health', text: `${s.label} has used its monthly cap ($${s.usd.toFixed(2)} of $${s.capUsd.toFixed(2)}).` });
    else if (s.capUsd && s.usd >= s.capUsd * 0.8) out.push({ level: 'late', section: 'health', text: `${s.label} is at ${Math.round((s.usd / s.capUsd) * 100)}% of its monthly cap.` });
  }
  const top = metrics.topError;
  if (metrics.errors24h >= 5 && metrics.errors24h >= metrics.errorsPrev24h * 2 && top) {
    out.push({ level: 'late', section: 'audit', text: `${top.area} / ${top.code} errors went from ${top.before} to ${top.n} in the last 24 hours.` });
  }
  return out.sort((a, b) => LEVEL[a.level] - LEVEL[b.level]);
}

/** Change against the previous period: positive, negative or flat, for the KPI captions. */
export function delta(current: number, previous: number): { sign: 'up' | 'down' | 'flat'; amount: number } {
  const amount = current - previous;
  return { sign: amount > 0 ? 'up' : amount < 0 ? 'down' : 'flat', amount: Math.abs(amount) };
}
