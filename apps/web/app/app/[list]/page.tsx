import { notFound } from 'next/navigation';
import { SMART_LISTS, type SmartListKey } from '@/components/shell/nav';
import { SmartListPage } from '@/components/pages/smart-list';

export const dynamicParams = false;

export function generateStaticParams() {
  return SMART_LISTS.map((list) => ({ list }));
}

export default async function Page({ params }: { params: Promise<{ list: string }> }) {
  const { list } = await params;
  if (!SMART_LISTS.includes(list as SmartListKey)) notFound();
  return <SmartListPage list={list as SmartListKey} />;
}
