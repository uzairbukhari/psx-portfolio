import { useState } from 'react';
import { Alert, Text } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useQueryClient } from '@tanstack/react-query';
import {
  portfolioName,
  ALL_PORTFOLIOS,
  type PortfolioAccount,
} from '@shared/portfolio-account.ts';
import {
  openAccountBackup,
  parseBackup,
  type BackupPackage,
} from '@shared/vault-backup.ts';
import type { Portfolio } from '@shared/portfolio.ts';
import { randomUUID } from 'expo-crypto';
import { usePortfolio } from '@/data/usePortfolio';
import { useVault } from '@/vault/VaultProvider';
import {
  Button,
  Card,
  Input,
  Muted,
  Notice,
  Screen,
  useKitStyles,
} from '@/ui/kit';

export default function Restore() {
  const p = usePortfolio();
  const { session } = useVault();
  const cache = useQueryClient();
  const styles = useKitStyles();
  const [legacy, setLegacy] = useState<Portfolio | null>(null);
  const [destination, setDestination] = useState('');
  const [newName, setNewName] = useState('');
  const [backup, setBackup] = useState<BackupPackage | null>(null);
  const [preview, setPreview] = useState<PortfolioAccount | null>(null);
  const [baseRevision, setBaseRevision] = useState(0);
  const [secret, setSecret] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function pick() {
    setBusy(true);
    setMessage('');
    setPreview(null);
    setBackup(null);
    setSecret('');
    setLegacy(null);
    setDestination('');
    setNewName('');
    try {
      const selected = await DocumentPicker.getDocumentAsync({
        type: ['application/json', '*/*'],
        copyToCacheDirectory: true,
      });
      if (selected.canceled || !selected.assets[0]) return;
      const parsed = parseBackup(await new File(selected.assets[0].uri).text());
      setBaseRevision(p.revision);
      if (parsed.type === 'encrypted') setBackup(parsed.backup);
      else if (parsed.type === 'account') setPreview(parsed.account);
      else setLegacy(parsed.portfolio);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not read backup.');
    } finally {
      setBusy(false);
    }
  }
  async function decrypt() {
    if (!backup) return;
    setBusy(true);
    setMessage('');
    try {
      setPreview(
        await openAccountBackup(
          backup,
          recovery ? { recovery: secret } : { password: secret },
        ),
      );
      setSecret('');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not open backup.');
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    if (!preview && !legacy) return;
    setBusy(true);
    setMessage('');
    try {
      if (legacy) {
        if (!destination) throw Error('Choose the destination portfolio.');
        const target =
          destination === 'new'
            ? { id: randomUUID(), name: portfolioName(newName) }
            : { id: destination };
        await p.save(legacy, { target, expectedRevision: baseRevision });
      } else await session.saveAccount(preview!, baseRevision, { replaceAll: true });
      await cache.invalidateQueries({ queryKey: ['portfolio-account'] });
      setPreview(null);
      setBackup(null);
      setMessage('All portfolios restored.');
      p.select(ALL_PORTFOLIOS);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not restore backup.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen edges={['bottom']}>
      <Text style={styles.title}>Restore account backup</Text>
      <Muted>
        Open the backup on this phone, then review every portfolio before
        replacing account data.
      </Muted>
      {message ? <Notice>{message}</Notice> : null}
      <Button
        label="Choose backup"
        disabled={busy || p.offline}
        onPress={() => void pick()}
      />
      {backup && !preview ? (
        <Card>
          <Input
            label={recovery ? 'Backup recovery key' : 'Backup vault password'}
            value={secret}
            onChangeText={setSecret}
            secureTextEntry={!recovery}
            autoCapitalize="none"
          />
          <Button
            label="Preview backup"
            disabled={busy || !secret}
            onPress={() => void decrypt()}
          />
          <Button
            label={recovery ? 'Use password' : 'Use recovery key'}
            variant="text"
            onPress={() => {
              setRecovery(!recovery);
              setSecret('');
            }}
          />
        </Card>
      ) : null}
      {legacy ? (
        <Card>
          <Text style={styles.strong}>Restore one portfolio</Text>
          <Muted>
            Choose which portfolio this readable backup should replace.
          </Muted>
          {p.account?.portfolios.map((e) => (
            <Button
              key={e.id}
              label={`${destination === e.id ? '✓ ' : ''}${e.name}`}
              variant="outline"
              disabled={busy}
              onPress={() => setDestination(e.id)}
            />
          ))}
          <Button
            label="Create new portfolio"
            variant="outline"
            disabled={busy}
            onPress={() => setDestination('new')}
          />
          {destination === 'new' ? (
            <Input
              label="Portfolio name"
              value={newName}
              onChangeText={setNewName}
            />
          ) : null}
          <Button
            label="Restore to selected portfolio"
            disabled={
              busy ||
              p.offline ||
              !destination ||
              (destination === 'new' && !newName.trim())
            }
            onPress={() =>
              Alert.alert(
                'Restore this portfolio?',
                `This replaces only ${destination === 'new' ? newName : p.account?.portfolios.find((e) => e.id === destination)?.name}.`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Restore',
                    style: 'destructive',
                    onPress: () => void restore(),
                  },
                ],
              )
            }
          />
        </Card>
      ) : null}
      {preview ? (
        <Card>
          <Text style={styles.strong}>
            {preview.portfolios.length} portfolios in this backup
          </Text>
          {preview.portfolios.map((e) => (
            <Text key={e.id} style={styles.text}>
              {e.name} · {e.portfolio.trades.length} trades
            </Text>
          ))}
          <Muted>
            This replaces every portfolio currently in your account.
          </Muted>
          <Button
            label="Replace all portfolios"
            variant="destructive"
            disabled={busy || p.offline}
            onPress={() =>
              Alert.alert(
                'Replace all portfolios?',
                preview.portfolios.map((e) => e.name).join(', '),
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Restore',
                    style: 'destructive',
                    onPress: () => void restore(),
                  },
                ],
              )
            }
          />
        </Card>
      ) : null}
    </Screen>
  );
}
