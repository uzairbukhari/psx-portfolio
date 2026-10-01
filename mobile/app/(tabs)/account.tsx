import { Redirect } from 'expo-router';

// Account is now More (the avatar in the header).
export default function Account() {
  return <Redirect href="/more" />;
}
