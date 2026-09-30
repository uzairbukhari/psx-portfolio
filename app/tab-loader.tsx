import { Spinner } from '@/components/ui/spinner';

export function TabLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <output className="tab-loader" aria-live="polite">
      <Spinner className="size-6" />
      <span>{label}</span>
    </output>
  );
}
