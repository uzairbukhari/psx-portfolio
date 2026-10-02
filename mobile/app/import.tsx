import { useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { validate, type Portfolio } from '@shared/portfolio.ts';
import { parseJsonFile, previewImport, type ImportKind, type ImportPreview } from '@/data/imports';
import { usePortfolio } from '@/data/usePortfolio';
import { plural } from '@/data/format';
import { useTheme } from '@/theme/ThemeProvider';
import { Icon } from '@/ui/Icon';
import { Button, Card, Loading, Muted, Notice, Screen, SectionLabel, Stat, useKitStyles } from '@/ui/kit';
import { useToast } from '@/ui/Toast';

const SOURCES: { kind: ImportKind; title: string; help: string }[] = [
  { kind: 'ahl', title: 'AHL trade history', help: 'The JSON trade history exported from AHL. Duplicates are skipped.' },
  { kind: 'cdc', title: 'CDC dividend history', help: 'The JSON dividend history from CDC. Paid dividends replace matching PSX estimates.' },
];
const SHOWN_ROWS = 5;

type Pending = { preview: ImportPreview; fileName: string; baseRevision: number };
type Done = { summary: string; added: string; previous: Portfolio };

export default function Import() {
  const params = useLocalSearchParams<{ kind?: string }>();
  const only = params.kind === 'ahl' || params.kind === 'cdc' ? params.kind : null;
  const styles = useKitStyles();
  const { colors } = useTheme();
  const p = usePortfolio();
  const toast = useToast();
  const [busy, setBusy] = useState<ImportKind | 'saving' | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [allRows, setAllRows] = useState(false);

  async function choose(kind: ImportKind) {
    if (!p.portfolio) return;
    setMessage(null);
    setPending(null);
    setAllRows(false);
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
      setDone({ summary, added, previous });
      // Batch undo: one revisioned save puts the whole portfolio back as it was before the import.
      toast.show({
        message: `Imported ${added}`,
        actionLabel: 'Undo import',
        durationMs: 12000,
        onAction: async () => {
          await p.save(previous);
          setDone(null);
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
  const sources = only ? SOURCES.filter((s) => s.kind === only) : SOURCES;
  const rowsShown = pv ? (allRows ? pv.rows : pv.rows.slice(0, SHOWN_ROWS)) : [];

  async function undo() {
    if (!done || undoing) return;
    setUndoing(true);
    try {
      await p.save(done.previous);
      setDone(null);
      setMessage({ text: 'Import undone. Your portfolio is back as it was.', error: false });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Could not undo the import.', error: true });
    } finally {
      setUndoing(false);
    }
  }

  if (done)
    return (
      <Screen edges={['bottom']}>
        <View style={{ alignItems: 'center', gap: 12, paddingTop: 32, paddingBottom: 8 }}>
          <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: colors.gainSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={32} color={colors.gain} strokeWidth={2.6} />
          </View>
          <Text style={[styles.title, { textAlign: 'center' }]} accessibilityRole="header" accessibilityLiveRegion="polite">
            {done.added ? `${done.added.charAt(0).toUpperCase()}${done.added.slice(1)} imported` : 'Import saved'}
          </Text>
          <Text style={[styles.muted, { textAlign: 'center' }]}>{done.summary} Saved as one change you can undo.</Text>
        </View>
        <Button label="Set this month’s budget and targets" onPress={() => router.replace('/plan')} />
        <Button label="View in Activity" variant="outline" onPress={() => router.replace('/activity')} />
        <Button label="Undo import" variant="text" loading={undoing} onPress={() => void undo()} />
      </Screen>
    );

  return (
    <Screen edges={['bottom']}>
      <Text style={styles.muted}>Pick a file from your phone's Files app. You see what it would add before anything is saved.</Text>
      {message ? <Notice tone={message.error ? 'error' : 'success'}>{message.text}</Notice> : null}
      {pending && pv ? (
        <>
          <Card accessibilityLabel={`Preview of ${pending.fileName}: ${plural(pv.counts.trades, 'trade')}, ${plural(pv.counts.dividends, 'dividend')} to add. Nothing is saved yet.`}>
            <Text style={styles.sectionLabel}>Check before importing</Text>
            <Text style={styles.strong}>{pending.fileName}</Text>
            <View style={styles.row}>
              <Stat label="Trades to add"><Text style={styles.number}>{pv.counts.trades}</Text></Stat>
              <Stat label="Dividends to add"><Text style={styles.number}>{pv.counts.dividends}</Text></Stat>
            </View>
            <View style={styles.row}>
              <Stat label="New companies"><Text style={styles.number}>{pv.counts.companies}</Text></Stat>
              <Stat label="Replaced or duplicate entries"><Text style={styles.number}>{pv.counts.voided}</Text></Stat>
            </View>
            {pv.counts.voided ? <Muted>Existing entries marked voided (duplicates or replaced PSX estimates) stay in your history.</Muted> : null}
            <Muted>{pv.message}</Muted>
          </Card>
          {pv.counts.companies ? <Notice>{plural(pv.counts.companies, 'company', 'companies')} will be added without targets. You can set targets after importing.</Notice> : null}
          <SectionLabel>{pv.rows.length > rowsShown.length ? `First ${rowsShown.length} of ${pv.rows.length} rows` : `${plural(pv.rows.length, 'row')} to add`}</SectionLabel>
          <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
            {rowsShown.map((r, i, list) => (
              <View
                key={r.id}
                accessible
                accessibilityLabel={`${r.ticker}, ${r.label}, ${r.date}${r.detail ? `, ${r.detail}` : ''}`}
                style={[styles.listRow, i < list.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.line }]}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.strong}>{r.ticker} · {r.label}</Text>
                  <Text style={styles.muted}>{r.date}{r.detail ? ` · ${r.detail}` : ''}</Text>
                </View>
              </View>
            ))}
          </View>
          {pv.rows.length > SHOWN_ROWS ? <Button label={allRows ? `Show the first ${SHOWN_ROWS} only` : `Show all ${pv.rows.length} rows`} variant="text" onPress={() => setAllRows((v) => !v)} /> : null}
          <Button label={busy === 'saving' ? 'Saving…' : `Import ${plural(pv.rows.length, 'entry', 'entries')}`} icon="check" loading={busy === 'saving'} disabled={p.offline} onPress={() => void confirm()} />
          <Button label="Choose another file" variant="outline" disabled={busy === 'saving'} onPress={() => setPending(null)} />
        </>
      ) : (
        sources.map((s) => (
          <Card key={s.kind}>
            <Text style={styles.strong}>{s.title}</Text>
            <Muted>{s.help}</Muted>
            <Button label={busy === s.kind ? 'Reading file…' : 'Choose file'} icon="upload" loading={busy === s.kind} disabled={busy !== null} onPress={() => void choose(s.kind)} />
          </Card>
        ))
      )}
      {only && !pending ? <Button label={only === 'ahl' ? 'Import CDC dividends instead' : 'Import AHL trades instead'} variant="text" onPress={() => router.setParams({ kind: only === 'ahl' ? 'cdc' : 'ahl' })} /> : null}
      <Muted>Finqalab PDF reports are still web-only.</Muted>
    </Screen>
  );
}
