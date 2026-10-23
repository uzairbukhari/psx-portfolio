import { PricingPage } from '../marketing/pages';
import { marketingOnly } from '../marketing/route';
import { pageMetadata } from '@/lib/marketing-seo';

export const metadata = pageMetadata('pricing');

export default async function Page() {
  await marketingOnly('/pricing');
  return <PricingPage />;
}
