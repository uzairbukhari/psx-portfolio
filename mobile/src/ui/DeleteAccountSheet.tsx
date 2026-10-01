import { useState } from 'react';
import { View } from 'react-native';
import { confirmationMatches } from '@shared/account-deletion.ts';
import { Button, Input, Muted, Notice, Sheet } from './kit';

/** Typed-confirmation sheet for deleting the account: the delete button stays off until the email is typed. */
export function DeleteAccountSheet({
  email,
  visible,
  onClose,
  onDelete,
}: {
  email: string;
  visible: boolean;
  onClose: () => void;
  onDelete: (confirm: string) => Promise<void>;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = confirmationMatches(typed, email);

  function close() {
    if (busy) return;
    setTyped('');
    setError(null);
    onClose();
  }
  async function run() {
    setBusy(true);
    setError(null);
    try {
      await onDelete(typed.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete your account.');
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} title="Delete your account?" onClose={close}>
      <Muted>
        This permanently deletes everything stored for {email}: your portfolio and ledger, AI reviews and usage, research jobs and every signed-in phone.
        It cannot be undone. Export a backup first if you might need it.
      </Muted>
      <Input
        label="Type your email address to confirm"
        value={typed}
        onChangeText={setTyped}
        placeholder={email}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <View style={{ gap: 8, marginTop: 4 }}>
        <Button label="Delete everything" variant="destructive" icon="close" disabled={!ready} loading={busy} onPress={() => void run()} />
        <Button label="Cancel" variant="outline" disabled={busy} onPress={close} />
      </View>
    </Sheet>
  );
}
