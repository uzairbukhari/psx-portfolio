import { Redirect } from 'expo-router';

// Reports now live in Portfolio › Insights. The old path keeps working for saved links.
export default function Reports() {
  return <Redirect href={{ pathname: '/portfolio', params: { segment: 'insights' } }} />;
}
