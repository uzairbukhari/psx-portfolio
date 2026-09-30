import { Spinner } from '@/components/ui/spinner';

export function TabLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="tab-loader" role="status" aria-live="polite">
      <Spinner className="size-6" />
      <span>{label}</span>
    </div>
  );
}
