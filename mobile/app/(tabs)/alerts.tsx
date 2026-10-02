import { Redirect } from 'expo-router';

// Alerts are now the Inbox (the bell in the header).
export default function Alerts() {
  return <Redirect href="/inbox" />;
}
