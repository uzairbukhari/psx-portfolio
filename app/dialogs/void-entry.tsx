'use client';
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { voidEntry } from '@/lib/corrections';
import type { Portfolio } from '@/lib/portfolio';
import { clonePortfolio } from '../hooks/use-portfolio';
import { usePortfolioContext } from '../portfolio-context';

export type LedgerList = 'trades' | 'dividends' | 'stockSplits';

function withVoided(
  p: Portfolio,
  list: LedgerList,
  id: string,
  voided: boolean,
): Portfolio {
  const next = clonePortfolio(p);
  if (list === 'trades') next.trades = voidEntry(next.trades, id, voided);
  else if (list === 'dividends')
    next.dividends = voidEntry(next.dividends ?? [], id, voided);
  else next.stockSplits = voidEntry(next.stockSplits ?? [], id, voided);
  return next;
}

/** Voids one ledger entry (audit record stays) and offers an Undo toast. */
export function useVoidWithUndo() {
  const { save, latest, toast } = usePortfolioContext();
  return async function voidWithUndo(
    list: LedgerList,
    id: string,
    savedMessage: string,
  ) {
    await save(withVoided(latest(), list, id, true));
    toast({
      title: savedMessage,
      description: 'The audit record is kept.',
      type: 'success',
      action: {
        label: 'Undo',
        onClick: () => {
          void save(withVoided(latest(), list, id, false)).then(
            () => toast({ title: 'Restored.', type: 'success' }),
            (e: unknown) =>
              toast({
                title: 'Could not undo',
                description: e instanceof Error ? e.message : String(e),
                type: 'error',
              }),
          );
        },
      },
    });
  };
}

/** "Void entry" button guarded by an accessible confirmation dialog. */
export function VoidEntryButton({
  what,
  disabled,
  onConfirm,
}: {
  what: string;
  disabled?: boolean;
  onConfirm: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  return (
    <>
      <button
        type="button"
        className="secondary"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Void entry
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void this {what}?</AlertDialogTitle>
            <AlertDialogDescription>
              It stops counting towards your holdings, cost and income, but its
              audit record remains and you can undo straight afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep entry</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={working}
              onClick={() => {
                setWorking(true);
                void onConfirm().finally(() => {
                  setWorking(false);
                  setOpen(false);
                });
              }}
            >
              Void {what}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
