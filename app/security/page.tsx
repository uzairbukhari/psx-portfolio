import { SecurityPage } from '../marketing/pages';
import { marketingOnly } from '../marketing/route';
import { pageMetadata } from '@/lib/marketing-seo';

export const metadata = pageMetadata('security');

export default async function Page() {
  await marketingOnly('/security');
  return <SecurityPage />;
}
