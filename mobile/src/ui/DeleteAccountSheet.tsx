import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { confirmationMatches } from '@shared/account-deletion.ts';
import { colors, radii } from '@/theme/tokens';
import { Button, Input, Muted, Notice } from './kit';

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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView edges={['bottom']} style={styles.sheet} accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">
            Delete your account?
          </Text>
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
            <Button label="Delete everything" variant="danger" icon="close" disabled={!ready} loading={busy} onPress={() => void run()} />
            <Button label="Cancel" variant="secondary" disabled={busy} onPress={close} />
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, padding: 16, gap: 12 },
  title: { color: colors.foreground, fontSize: 20, fontWeight: '700' },
});
