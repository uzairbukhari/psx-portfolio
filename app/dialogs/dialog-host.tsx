'use client';
import type { DialogRequest } from '../portfolio-context';
import { CompanyDialog } from './company-dialog';
import { DividendDialog } from './dividend-dialog';
import { QuoteDialog } from './quote-dialog';
import { ReceiptDialog } from './receipt-dialog';
import { SplitDialog } from './split-dialog';
import { TradeDialog } from './trade-dialog';

/** Renders whichever ledger dialog was requested. Each dialog owns its draft, so closing discards it and failed saves keep it. */
export function DialogHost({
  request,
  onClose,
}: {
  request: DialogRequest | null;
  onClose: () => void;
}) {
  if (!request) return null;
  switch (request.type) {
    case 'trade':
      return (
        <TradeDialog
          key={request.editing?.id ?? `new-${request.ticker ?? ''}-${request.kind ?? 'buy'}`}
          ticker={request.ticker}
          kind={request.kind}
          editing={request.editing}
          onClose={onClose}
        />
      );
    case 'dividend':
      return (
        <DividendDialog
          key={request.editing?.id ?? `new-${request.ticker ?? ''}`}
          ticker={request.ticker}
          editing={request.editing}
          onClose={onClose}
        />
      );
    case 'split':
      return (
        <SplitDialog
          key={request.editing?.id ?? `new-${request.ticker ?? ''}`}
          ticker={request.ticker}
          editing={request.editing}
          onClose={onClose}
        />
      );
    case 'receipt':
      return (
        <ReceiptDialog
          key={request.dividend.id}
          dividend={request.dividend}
          onClose={onClose}
        />
      );
    case 'company':
      return (
        <CompanyDialog
          key={request.ticker ?? 'new'}
          ticker={request.ticker}
          onClose={onClose}
        />
      );
    case 'quote':
      return (
        <QuoteDialog key={request.ticker} ticker={request.ticker} onClose={onClose} />
      );
  }
}
