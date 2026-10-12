// Shown while the vault decrypts the portfolio. Same grid as the Holdings view, so the first real paint lands in
// place instead of popping in, and the wait reads as progress.
import { Skeleton } from '@/components/ui/skeleton';

export function DashboardSkeleton() {
  return (
    <main className="desk" aria-busy="true">
      <output className="sr-only">Decrypting your portfolio…</output>
      <div className="grid gap-4 py-5">
        <section className="rounded-2xl border border-border bg-card p-5 md:p-7">
          <div className="grid gap-6 md:grid-cols-[1.4fr_1fr_1fr]">
            <div className="space-y-3">
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-11 w-64 max-w-full" />
              <Skeleton className="h-3.5 w-52 max-w-full" />
            </div>
            {[0, 1].map((i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-7 w-36" />
                <Skeleton className="h-3.5 w-40" />
              </div>
            ))}
          </div>
        </section>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-[300px] rounded-2xl" />
          <Skeleton className="h-[300px] rounded-2xl" />
        </div>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[74px] rounded-2xl" />
        ))}
      </div>
    </main>
  );
}
