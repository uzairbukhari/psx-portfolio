import { Component, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';
import { Button } from './kit';

function Fallback({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 24, gap: 12 }}>
      <Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 20, fontWeight: '700' }}>Something went wrong on this screen</Text>
      <Text style={{ color: colors.muted, fontSize: 14 }}>Your portfolio is safe; nothing was lost. {message}</Text>
      <View style={{ marginTop: 8 }}>
        <Button label="Reload the app screens" onPress={onRetry} />
      </View>
    </SafeAreaView>
  );
}

/** A render crash shows this message with a retry instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) return <Fallback message={this.state.error.message} onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}
