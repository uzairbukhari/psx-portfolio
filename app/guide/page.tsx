import { GuidePage } from '../marketing/pages';
import { marketingOnly } from '../marketing/route';
import { pageMetadata } from '@/lib/marketing-seo';

export const metadata = pageMetadata('guide');

export default async function Page() {
  await marketingOnly('/guide');
  return <GuidePage />;
}
