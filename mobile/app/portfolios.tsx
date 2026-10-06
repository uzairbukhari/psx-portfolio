import { useState } from 'react';
import { Alert, Text } from 'react-native';
import { router } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useQueryClient } from '@tanstack/react-query';
import { blankPortfolio } from '@shared/portfolio.ts';
import {
  ALL_PORTFOLIOS,
  hasFinancialRecords,
  normalizeAccount,
  portfolioName,
  removePortfolio,
  renamePortfolio,
  setPortfolioLocked,
  LEGACY_PORTFOLIO_ID,
} from '@shared/portfolio-account.ts';
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

export default function Portfolios() {
  const p = usePortfolio();
  const { session } = useVault();
  const cache = useQueryClient();
  const styles = useKitStyles();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function choose(id: string) {
    p.select(id);
    router.back();
  }
  async function change(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await cache.invalidateQueries({ queryKey: ['portfolio-account'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save portfolio.');
      await cache.invalidateQueries({ queryKey: ['portfolio-account'] });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen edges={['bottom']}>
      <Text style={styles.title}>Portfolios</Text>
      <Muted>
        Manage broker accounts and investment goals under one login.
      </Muted>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {p.account?.portfolios.map((entry) => (
        <Card key={entry.id}>
          <Text style={styles.strong}>{entry.name}</Text>
          <Muted>{entry.locked ? 'Locked · read only' : 'Open for edits'}</Muted><Button label={entry.locked?'Unlock':'Lock'} variant="text" disabled={busy || p.offline} onPress={()=>void change(async()=>{await session.saveAccount(setPortfolioLocked(session.account,entry.id,!entry.locked),p.revision)})} />
          <Button
            label="Rename"
            variant="text"
            onPress={() => {
              setEditing(entry.id);
              setName(entry.name);
            }}
            disabled={busy || p.offline}
          />
          {entry.id !== LEGACY_PORTFOLIO_ID && !entry.locked && !hasFinancialRecords(entry.portfolio) &&
          p.account!.portfolios.length > 1 ? (
            <Button
              label="Delete empty portfolio"
              variant="text"
              disabled={busy || p.offline}
              onPress={() =>
                Alert.alert('Delete empty portfolio?', entry.name, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () =>
                      void change(async () => {
                        await session.saveAccount(
                          removePortfolio(session.account, entry.id),
                          p.revision,
                        );
                        if (p.selectedId === entry.id) p.select(ALL_PORTFOLIOS);
                      }),
                  },
                ])
              }
            />
          ) : null}
        </Card>
      ))}
      <Input
        label={editing ? 'New portfolio name' : 'Create portfolio'}
        value={name}
        onChangeText={setName}
        maxLength={80}
        placeholder="For example, AHL or Finqalab"
        editable={!busy && !p.offline}
      />
      <Button
        label={editing ? 'Save name' : 'Create portfolio'}
        disabled={!name.trim() || busy || p.offline}
        loading={busy}
        onPress={() =>
          void change(async () => {
            const next = editing
              ? renamePortfolio(session.account, editing, name)
              : normalizeAccount(
                  {
                    ...session.account,
                    portfolios: [
                      ...session.account.portfolios,
                      {
                        id: Crypto.randomUUID(),
                        name: portfolioName(name),
                        portfolio: blankPortfolio(),
                      },
                    ],
                  },
                  false,
                );
            await session.saveAccount(next, p.revision);
            setEditing(null);
            setName('');
          })
        }
      />
      {editing ? (
        <Button
          label="Cancel rename"
          variant="text"
          onPress={() => {
            setEditing(null);
            setName('');
          }}
        />
      ) : null}
    </Screen>
  );
}
