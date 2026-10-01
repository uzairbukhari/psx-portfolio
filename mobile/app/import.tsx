import { useState } from 'react';
import { Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { validate } from '@shared/portfolio.ts';
import { parseJsonFile, previewImport, type ImportKind, type ImportPreview } from '@/data/imports';
import { usePortfolio } from '@/data/usePortfolio';
import { colors } from '@/theme/tokens';
import { Button, Card, Header, Loading, Muted, Notice, Screen, SectionLabel, Stat, styles } from '@/ui/kit';
import { useToast } from '@/ui/Toast';

const SOURCES: { kind: ImportKind; title: string; help: string }[] = [
  { kind: 'ahl', title: 'AHL trade history', help: 'The JSON trade history exported from AHL. Duplicates are skipped.' },
  { kind: 'cdc', title: 'CDC dividend history', help: 'The JSON dividend history from CDC. Paid dividends replace matching PSX estimates.' },
];
const SHOWN_ROWS = 50;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Pending = { preview: ImportPreview; fileName: string; baseRevision: number };

export default function Import() {
  const p = usePortfolio();
  const toast = useToast();
  const [busy, setBusy] = useState<ImportKind | 'saving' | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function choose(kind: ImportKind) {
    if (!p.portfolio) return;
    setMessage(null);
    setPending(null);
    setBusy(kind);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      const raw = parseJsonFile(await new File(asset.uri).text());
      const preview = previewImport(kind, p.portfolio, raw);
      if (!preview.next) setMessage({ text: preview.message, error: false });
      else setPending({ preview, fileName: asset.name ?? 'the file', baseRevision: p.revision });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Import failed.', error: true });
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!pending?.preview.next || !p.portfolio) return;
    if (p.revision !== pending.baseRevision) {
      setPending(null);
      setMessage({ text: 'Your portfolio changed after this preview. Nothing was saved. Choose the file again.', error: true });
      return;
    }
    setBusy('saving');
    try {
      const previous = p.portfolio;
      validate(pending.preview.next);
      await p.save(pending.preview.next);
      const { counts, message: summary } = pending.preview;
      const added = [
        counts.trades ? plural(counts.trades, 'trade') : '',
        counts.dividends ? plural(counts.dividends, 'dividend') : '',
      ].filter(Boolean).join(' and ');
      setPending(null);
      setMessage({ text: summary, error: false });
      // Batch undo: one revisioned save puts the whole portfolio back as it was before the import.
      toast.show({
        message: `Imported ${added}`,
        actionLabel: 'Undo import',
        durationMs: 12000,
        onAction: async () => {
          await p.save(previous);
          setMessage({ text: 'Import undone. Your portfolio is back as it was.', error: false });
          toast.show({ message: 'Import undone' });
        },
      });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Import failed. Nothing was saved.', error: true });
    } finally {
      setBusy(null);
    }
  }

  if (p.isLoading) return <Screen edges={['bottom']}><Loading /></Screen>;

  const pv = pending?.preview;
  return (
    <Screen edges={['bottom']}>
      <Header title="Import" subtitle="Pick a file from your phone's Files app. You see what it would add before anything is saved." />
      {message ? <Notice tone={message.error ? 'error' : 'warn'}>{message.text}</Notice> : null}
      {pending && pv ? (
        <>
          <Card accessibilityLabel={`Preview of ${pending.fileName}: ${plural(pv.counts.trades, 'trade')}, ${plural(pv.counts.dividends, 'dividend')} to add. Nothing is saved yet.`}>
            <Text style={styles.strong}>Preview · {pending.fileName}</Text>
            <View style={styles.row}>
              <Stat label="Trades to add"><Text style={styles.strong}>{pv.counts.trades}</Text></Stat>
              <Stat label="Dividends to add"><Text style={styles.strong}>{pv.counts.dividends}</Text></Stat>
            </View>
            {pv.counts.voided || pv.counts.companies ? (
              <Muted>
                {[pv.counts.voided ? `${plural(pv.counts.voided, 'existing entry', 'existing entries')} marked voided (duplicates or replaced estimates)` : '', pv.counts.companies ? `${plural(pv.counts.companies, 'new company', 'new companies')} added` : ''].filter(Boolean).join(' · ')}
              </Muted>
            ) : null}
            <Muted>{pv.message}</Muted>
          </Card>
          <SectionLabel>{pv.rows.length > SHOWN_ROWS ? `First ${SHOWN_ROWS} of ${pv.rows.length} rows` : `${plural(pv.rows.length, 'row')} to add`}</SectionLabel>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {pv.rows.slice(0, SHOWN_ROWS).map((r, i, list) => (
              <View
                key={r.id}
                accessible
                accessibilityLabel={`${r.ticker}, ${r.label}, ${r.date}${r.detail ? `, ${r.detail}` : ''}`}
                style={[styles.listRow, i < list.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.strong}>{r.ticker} · {r.label}</Text>
                  <Text style={styles.muted}>{r.date}{r.detail ? ` · ${r.detail}` : ''}</Text>
                </View>
              </View>
            ))}
          </Card>
          <Button label={busy === 'saving' ? 'Saving…' : `Save ${plural(pv.rows.length, 'entry', 'entries')}`} icon="check" loading={busy === 'saving'} onPress={() => void confirm()} />
          <Button label="Cancel" variant="secondary" disabled={busy === 'saving'} onPress={() => setPending(null)} />
        </>
      ) : (
        SOURCES.map((s) => (
          <Card key={s.kind}>
            <Text style={styles.strong}>{s.title}</Text>
            <Muted>{s.help}</Muted>
            <Button label={busy === s.kind ? 'Reading file…' : 'Choose file'} icon="upload" loading={busy === s.kind} disabled={busy !== null} onPress={() => void choose(s.kind)} />
          </Card>
        ))
      )}
      <Muted>Finqalab PDF reports are still web-only.</Muted>
    </Screen>
  );
}
