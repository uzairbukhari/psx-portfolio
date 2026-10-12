export const ago = (iso: string | null, now: string | number = Date.now()) => {
  if (!iso) return 'never';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 'unknown';
  const minutes = Math.max(0, Math.round(((typeof now === 'number' ? now : Date.parse(now)) - at) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 120) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
};
export const usd = (n: number) => `$${n.toFixed(2)}`;
export const title = (name: string) => { const t = name.replaceAll('_', ' ').replaceAll('-', ' '); return t[0].toUpperCase() + t.slice(1); };
