import { Redirect } from 'expo-router';

// The Monthly SIP tab is now Plan.
export default function Sip() {
  return <Redirect href="/plan" />;
}
