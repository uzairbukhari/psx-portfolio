'use client';
// Every heavy surface that is not part of the first Holdings paint, as its own chunk. portfolio.tsx may import
// only types from these modules: one static value import pulls the whole module back into the main chunk.
import {
  lazy,
  Suspense,
  type ComponentType,
  type ReactNode,
} from 'react';
import type { JSX } from 'react';
type IntrinsicAttributes = JSX.IntrinsicAttributes;
import { Skeleton } from '@/components/ui/skeleton';

/** Same footprint as a report row, so the swap from fallback to content does not shift the layout. */
export function PanelFallback({ label = 'Loading' }: { label?: string }) {
  return (
    <output className="panel-fallback block" aria-live="polite" aria-label={label}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[92px] rounded-2xl" />
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-[320px] rounded-2xl" />
        <Skeleton className="h-[320px] rounded-2xl" />
      </div>
    </output>
  );
}

/** Lazy component with the original's props and its own Suspense boundary. `preload()` warms the chunk. */
function lazyView<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  fallback: ReactNode = <PanelFallback />,
) {
  const Inner = lazy(load);
  function View(props: P) {
    return (
      <Suspense fallback={fallback}>
        <Inner {...(props as P & IntrinsicAttributes)} />
      </Suspense>
    );
  }
  View.preload = () => void load().catch(() => {});
  return View;
}

/** Same, for a named export: lazyNamed(() => import('./x'), (m) => m.X). */
function lazyNamed<M, P extends object>(
  load: () => Promise<M>,
  pick: (module: M) => ComponentType<P>,
  fallback?: ReactNode,
) {
  return lazyView<P>(() => load().then((m) => ({ default: pick(m) })), fallback);
}

// Tabs.
export const PortfolioReports = lazyView(() => import('./portfolio-reports'));
export const AssetReports = lazyView(() => import('./asset-reports'));
export const AllReports = lazyNamed(() => import('./asset-reports'), (m) => m.AllReports);
export const PortfolioInsights = lazyNamed(() => import('./insights-all'), (m) => m.PortfolioInsights);
export const AllInsights = lazyNamed(() => import('./insights-all'), (m) => m.AllInsights);
export const LedgerTimeline = lazyView(() => import('./ledger-timeline'));
export const PlanPage = lazyView(() => import('./plan-page'));
export const MonthlyPicks = lazyView(() => import('./monthly-picks'));
export const CompanyDetail = lazyView(() => import('./company-detail'));
export const GoldSilverSection = lazyView(() => import('./gold-silver'));
export const ForeignCurrencySection = lazyView(() => import('./foreign-currency'));
export const SavingsPlansSection = lazyView(() => import('./savings-plans'));
export const MutualFundsSection = lazyView(() => import('./mutual-funds'));
export const SettingsView = lazyView(() => import('./settings-view'));
export const NotificationsView = lazyView(() => import('./notifications-view'));
// Super admin only: regular users never download these.
export const ResearchDesk = lazyView(() => import('./research-desk'));
export const AiLab = lazyView(() => import('./ai-lab'));

// Dialogs open on demand, so they have no visible fallback.
export const TargetsEditor = lazyView(() => import('./targets-editor'), null);
export const AhlImportDialog = lazyNamed(() => import('./ahl-import-dialog'), (m) => m.AhlImportDialog, null);
export const FinqalabImportDialog = lazyNamed(() => import('./finqalab-import-dialog'), (m) => m.FinqalabImportDialog, null);
export const BrokerImportDialog = lazyNamed(() => import('./broker-import-dialog'), (m) => m.BrokerImportDialog, null);
export const IpoImportDialog = lazyNamed(() => import('./ipo-import-dialog'), (m) => m.IpoImportDialog, null);
export const DividendSyncView = lazyNamed(() => import('./dividend-sync-view'), (m) => m.DividendSyncView);

/** Warm a tab's chunk when the pointer or focus reaches its link, so the click feels instant. */
export function preloadTab(tab: string) {
  const views: Record<string, { preload: () => void } | undefined> = {
    reports: PortfolioReports,
    history: LedgerTimeline,
    sip: MonthlyPicks,
    'sip-plan': PlanPage,
    settings: SettingsView,
  };
  views[tab]?.preload();
}
