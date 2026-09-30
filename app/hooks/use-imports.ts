'use client';
import {
  taxSummary,
  today,
  supersedeAutoWithImports,
  validate,
  type AppNotification,
  type Portfolio,
} from '@/lib/portfolio';
import { addNotifications, dividendNotifications } from '@/lib/notifications';
import { importCdcDividends } from '@/lib/imports/cdc-dividends';
import { importAhlTrades, parseAhlHistory } from '../ahl-import';
import { importFinqalabTrades, parseFinqalabReport } from '../finqalab-import';
import { clonePortfolio } from './use-portfolio';
import { usePortfolioContext } from '../portfolio-context';

function download(name: string, data: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function unknownCostWarning(next: Portfolio) {
  const tickers = [
    ...new Set(
      taxSummary(next)
        .sales.filter((s) => s.costBasis === null)
        .map((s) => s.ticker),
    ),
  ];
  if (!tickers.length) return '';
  return ` Warning: ${tickers.length === 1 ? 'a sale has' : tickers.length + ' sales have'} unknown cost basis (${tickers.join(', ')}) — edit the opening trade to enter its real cost for accurate tax figures.`;
}

/** File imports and backup/restore. Every handler reports its outcome through the page notice. */
export function useImports() {
  const { p, save, notify } = usePortfolioContext();

  function attempt(action: () => Promise<unknown>) {
    void action().catch((e) =>
      notify(e instanceof Error ? e.message : String(e), true),
    );
  }

  const restoreBackup = (f: File) =>
    attempt(async () => {
      const data = JSON.parse(await f.text());
      if (data.kind !== 'psx-portfolio-ledger' || data.schemaVersion !== 1)
        throw Error(
          'Choose a portfolio-ledger backup, not a company research file.',
        );
      validate(data.portfolio);
      await save(data.portfolio);
      notify('Portfolio backup restored.');
    });

  const importCdc = (f: File) =>
    attempt(async () => {
      const raw = JSON.parse(await f.text());
      const result = importCdcDividends(raw, p.companies, p.dividends ?? []);
      const skipped = `Skipped: ${result.skippedNotPaid} not paid, ${result.skippedDuplicate} duplicate, ${result.skippedUnknownTicker} unknown ticker, ${result.skippedInvalid} invalid.`;
      if (!result.imported) {
        notify(`No dividends imported. ${skipped}`, true);
        return;
      }
      const next = clonePortfolio(p);
      const { voided: replaced, ambiguous } = supersedeAutoWithImports(
        next,
        next.dividends ?? [],
        result.dividends,
      );
      if (ambiguous.length)
        throw Error(
          `Nothing was imported: ${ambiguous.map((d) => `${d.ticker} ${d.date}`).join(', ')} could belong to more than one expected PSX dividend. Void the expected record that does not apply (Activity), then import again.`,
        );
      const at = new Date().toISOString();
      addNotifications(next, [
        ...dividendNotifications(result.dividends, at),
        ...replaced.map(
          (d): AppNotification => ({
            id: `replaced:${d.id}`,
            at,
            kind: 'dividend-replaced',
            ticker: d.ticker,
            title: `${d.ticker} PSX estimate replaced`,
            body: `The PSX-announced dividend for ${d.date} was replaced by the actual CDC payment.`,
            read: false,
          }),
        ),
      ]);
      next.dividends = [...(next.dividends ?? []), ...result.dividends];
      await save(next);
      notify(
        `${result.imported} dividend${result.imported === 1 ? '' : 's'} imported${replaced.length ? `, replacing ${replaced.length} PSX auto record${replaced.length === 1 ? '' : 's'}` : ''}. ${skipped}`,
      );
    });

  const importFinqalab = (f: File) =>
    attempt(async () => {
      if (f.type && f.type !== 'application/pdf')
        throw Error('Choose a PDF report from Finqalab.');
      // PDF parsing is heavy, so it loads only when a report is actually imported.
      const { extractPdfText } = await import('../research-pdf');
      const { text } = await extractPdfText(new Uint8Array(await f.arrayBuffer()));
      const rows = parseFinqalabReport(text);
      const result = importFinqalabTrades(p, rows);
      if (!result.imported) {
        notify(
          `No Finqalab trades imported. Skipped: ${result.skippedDuplicate} already imported, ${result.skippedManualMatch} matching manual entries.`,
          true,
        );
        return;
      }
      const next = clonePortfolio(p);
      next.companies = result.companies;
      next.trades = [...next.trades, ...result.trades];
      await save(next);
      notify(
        `${result.imported} Finqalab trade${result.imported === 1 ? '' : 's'} imported. Skipped: ${result.skippedDuplicate} already imported, ${result.skippedManualMatch} matching manual entries.${result.addedCompanies ? ` Added ${result.addedCompanies} unapproved compan${result.addedCompanies === 1 ? 'y' : 'ies'}.` : ''}${unknownCostWarning(next)}`,
      );
    });

  const importAhl = (f: File) =>
    attempt(async () => {
      const rows = parseAhlHistory(JSON.parse(await f.text()));
      const result = importAhlTrades(p, rows);
      if (!result.imported) {
        notify(
          `No AHL trades imported. Skipped: ${result.skippedDuplicate} already imported, ${result.skippedManualMatch} matching manual entries.`,
          true,
        );
        return;
      }
      const next = clonePortfolio(p);
      next.companies = result.companies;
      for (const trade of next.trades) {
        if (result.voidedTradeIds.includes(trade.id)) trade.voided = true;
      }
      next.trades = [...next.trades, ...result.trades];
      await save(next);
      notify(
        `${result.imported} AHL trade${result.imported === 1 ? '' : 's'} imported. Skipped: ${result.skippedDuplicate} already imported, ${result.skippedManualMatch} matching manual entries.${result.voidedTradeIds.length ? ` Reconciled ${result.voidedTradeIds.length} duplicate opening balance${result.voidedTradeIds.length === 1 ? '' : 's'}.` : ''}${result.addedCompanies ? ` Added ${result.addedCompanies} unapproved compan${result.addedCompanies === 1 ? 'y' : 'ies'}.` : ''}${unknownCostWarning(next)}`,
      );
    });

  const exportBackup = () =>
    download(
      `psx-portfolio-${today()}.json`,
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: 'psx-portfolio-ledger',
          exportedAt: new Date().toISOString(),
          portfolio: p,
        },
        null,
        2,
      ),
    );

  return { attempt, restoreBackup, importCdc, importFinqalab, importAhl, exportBackup };
}
