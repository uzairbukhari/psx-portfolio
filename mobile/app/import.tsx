import { useState } from 'react';
import { Text } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { validate } from '@shared/portfolio.ts';
import { applyAhlImport, applyCdcImport, parseJsonFile, type ImportKind } from '@/data/imports';
import { usePortfolio } from '@/data/usePortfolio';
import { Button, Card, Header, Loading, Muted, Notice, Screen, styles } from '@/ui/kit';

const SOURCES: { kind: ImportKind; title: string; help: string }[] = [
  { kind: 'ahl', title: 'AHL trade history', help: 'The JSON trade history exported from AHL. Duplicates are skipped.' },
  { kind: 'cdc', title: 'CDC dividend history', help: 'The JSON dividend history from CDC. Paid dividends replace matching PSX estimates.' },
];

export default function Import() {
  const p = usePortfolio();
  const [busy, setBusy] = useState<ImportKind | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function run(kind: ImportKind) {
    if (!p.portfolio) return;
    setMessage(null);
    setBusy(kind);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const raw = parseJsonFile(await new File(picked.assets[0].uri).text());
      const outcome = kind === 'ahl' ? applyAhlImport(p.portfolio, raw) : applyCdcImport(p.portfolio, raw);
      if (outcome.next) {
        validate(outcome.next);
        await p.save(outcome.next);
      }
      setMessage({ text: outcome.message, error: false });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Import failed.', error: true });
    } finally {
      setBusy(null);
    }
  }

  if (p.isLoading) return <Screen edges={['bottom']}><Loading /></Screen>;

  return (
    <Screen edges={['bottom']}>
      <Header title="Import" subtitle="Pick a file from your phone's Files app. Nothing is changed unless the whole file checks out." />
      {message ? <Notice tone={message.error ? 'error' : 'warn'}>{message.text}</Notice> : null}
      {SOURCES.map((s) => (
        <Card key={s.kind}>
          <Text style={styles.strong}>{s.title}</Text>
          <Muted>{s.help}</Muted>
          <Button label={busy === s.kind ? 'Importing…' : 'Choose file'} icon="upload" loading={busy === s.kind} disabled={busy !== null} onPress={() => void run(s.kind)} />
        </Card>
      ))}
      <Muted>Finqalab PDF reports are still web-only.</Muted>
    </Screen>
  );
}
