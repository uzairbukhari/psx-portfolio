import { Redirect } from 'expo-router';

// Monthly Picks now lives in Plan › Monthly Picks. The old path keeps working for saved links.
export default function Picks() {
  return <Redirect href={{ pathname: '/plan', params: { mode: 'picks' } }} />;
}
