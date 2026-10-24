import { FeaturesPage } from '../marketing/pages';
import { marketingOnly } from '../marketing/route';
import { pageMetadata } from '@/lib/marketing-seo';

export const metadata = pageMetadata('features');

export default async function Page() {
  await marketingOnly('/features');
  return <FeaturesPage />;
}
