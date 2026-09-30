'use client';
import { Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IMPORT_OPTIONS, useImportPicker } from './import-actions';
import { usePortfolioContext } from './portfolio-context';

/**
 * Global "Add transaction": only the transaction types the ledger already supports, with the
 * existing imports beside them. `ticker` prefills company-specific entry points.
 */
export function AddTransactionMenu({ ticker }: { ticker?: string }) {
  const { busy, openDialog } = usePortfolioContext();
  const { pick, element } = useImportPicker();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="hdr-btn hdr-primary"
          disabled={busy}
          aria-label="Add transaction"
        >
          <Plus size={18} aria-hidden="true" />
          <span className="hdr-label">Add transaction</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="txn-menu">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{ticker ? `Add for ${ticker}` : 'Add manually'}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => openDialog({ type: 'trade', ticker, kind: 'buy' })}>
              Purchase
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openDialog({ type: 'trade', ticker, kind: 'sell' })}>
              Sale
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openDialog({ type: 'dividend', ticker })}>
              Dividend
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openDialog({ type: 'split', ticker })}>
              Stock split
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Import from a file</DropdownMenuLabel>
            {IMPORT_OPTIONS.map((o) => (
              <DropdownMenuItem key={o.kind} onClick={() => pick(o.kind)}>
                {o.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {element}
    </>
  );
}
