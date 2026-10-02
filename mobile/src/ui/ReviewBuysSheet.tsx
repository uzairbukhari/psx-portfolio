import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { money, today } from '@shared/portfolio.ts';
import { recordBuys } from '@/data/mutations';
import { parseReview, reviewRows, type ReviewRow, type SuggestedBuy } from '@/data/record-buys';
import { plural } from '@/data/format';
import { usePortfolio } from '@/data/usePortfolio';
import { Avatar, Button, Chip, Input, Muted, Notice, Sheet, useKitStyles } from './kit';
import { useToast } from './Toast';

/**
 * Review-and-record sheet shared by the Targets plan and Monthly Picks. Every suggested buy has editable
 * shares and price and an include toggle; "Record" saves all included buys as one revision (one undo).
 */
export function ReviewBuysSheet({
  visible,
  onClose,
  suggestions,
  month,
  feePct,
  title = 'Review and record',
}: {
  visible: boolean;
  onClose: () => void;
  suggestions: SuggestedBuy[];
  month: string;
  feePct: number;
  title?: string;
}) {
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      {/* Mounted only while open, so every opening starts from the current suggestions. */}
      {visible ? <ReviewBody suggestions={suggestions} month={month} feePct={feePct} onClose={onClose} /> : null}
    </Sheet>
  );
}

function ReviewBody({ suggestions, month, feePct, onClose }: { suggestions: SuggestedBuy[]; month: string; feePct: number; onClose: () => void }) {
  const p = usePortfolio();
  const toast = useToast();
  const styles = useKitStyles();
  const [rows, setRows] = useState<ReviewRow[]>(() => reviewRows(suggestions));
  const [excluded, setExcluded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  const included = rows.filter((r) => !excluded.includes(r.ticker));
  const parsed = parseReview(included, feePct);
  const patch = (ticker: string, change: Partial<ReviewRow>) => setRows((list) => list.map((r) => (r.ticker === ticker ? { ...r, ...change } : r)));
  const count = included.length;

  async function record() {
    // A second tap while the save is in flight must not record the buys twice.
    if (submitting.current || !p.portfolio) return;
    setError(null);
    if (Object.keys(parsed.errors).length || !parsed.buys.length) {
      setError(parsed.buys.length || Object.keys(parsed.errors).length ? 'Fix the highlighted rows first.' : 'Include at least one buy.');
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const previous = p.portfolio;
      await p.save(recordBuys(previous, parsed.buys, month, today(), 'SIP'));
      toast.show({
        message: `${plural(parsed.buys.length, 'buy')} recorded for ${month}`,
        actionLabel: 'Undo',
        durationMs: 12000,
        // One save put them all in; one save puts the portfolio back as it was.
        onAction: async () => {
          await p.save(previous);
          toast.show({ message: 'Undone. Your portfolio is back as it was.' });
        },
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the buys.');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  if (!rows.length) return <Notice>None of the suggestions has a price and at least one share, so there is nothing to record.</Notice>;
  return (
    <>
      <Muted>Check each buy against your broker confirmation, change anything that differs, then record them together.</Muted>
      {rows.map((r) => {
        const off = excluded.includes(r.ticker);
        return (
          <View key={r.ticker} style={[styles.card, off && { opacity: 0.55 }]}>
            <View style={styles.row}>
              <Avatar ticker={r.ticker} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={styles.strong}>{r.ticker}</Text>
                <Text style={styles.muted} numberOfLines={1}>{r.name}</Text>
              </View>
              <Chip
                label={off ? 'Left out' : 'Included'}
                accessibilityLabel={`${r.ticker}: ${off ? 'left out, tap to include' : 'included, tap to leave out'}`}
                selected={!off}
                onPress={() => setExcluded((x) => (off ? x.filter((t) => t !== r.ticker) : [...x, r.ticker]))}
              />
            </View>
            <View style={[styles.row, { alignItems: 'flex-start' }]}>
              <View style={{ flex: 1 }}>
                <Input label="Shares" value={r.shares} onChangeText={(shares) => patch(r.ticker, { shares })} keyboardType="number-pad" editable={!off} error={off ? null : parsed.errors[r.ticker] && /share/.test(parsed.errors[r.ticker]) ? parsed.errors[r.ticker] : null} />
              </View>
              <View style={{ flex: 1 }}>
                <Input label="Price (PKR)" value={r.price} onChangeText={(price) => patch(r.ticker, { price })} keyboardType="decimal-pad" editable={!off} error={off ? null : parsed.errors[r.ticker] && /price/.test(parsed.errors[r.ticker]) ? parsed.errors[r.ticker] : null} />
              </View>
            </View>
          </View>
        );
      })}
      <View style={styles.card} accessible accessibilityLabel={`Total ${money(parsed.total)}. ${money(parsed.gross)} for shares plus ${money(parsed.fees)} estimated fees.`}>
        <Text style={styles.statLabel}>Total for {plural(count, 'buy')}</Text>
        <Text style={styles.number}>{money(parsed.total)}</Text>
        <Muted>
          {money(parsed.gross)} plus {money(parsed.fees)} estimated fees ({feePct}%). Dated today and counted toward {month}. You can correct any line later in Activity.
        </Muted>
      </View>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button label={`Record ${plural(count, 'buy')}`} icon="check" loading={busy} disabled={count === 0 || p.offline} onPress={() => void record()} />
      {p.offline ? <Muted>You are offline, so recording is paused until you reconnect.</Muted> : null}
      <Button label="Cancel" variant="outline" disabled={busy} onPress={onClose} />
    </>
  );
}
