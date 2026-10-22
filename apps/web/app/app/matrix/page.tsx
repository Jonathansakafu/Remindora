'use client';
import { Spinner } from '@remindora/ui';
import { PageHeader } from '@/components/views/common';
import { MatrixView } from '@/components/views/matrix-view';
import { useTasks } from '@/lib/queries';

export default function Page() {
  const { data = [], isLoading } = useTasks({ view: 'all' });
  return (
    <div>
      <PageHeader title="Eisenhower Matrix" subtitle="Important = high or critical priority. Urgent = due within 48 hours." />
      {isLoading ? <div className="grid place-items-center py-20"><Spinner /></div> : <MatrixView tasks={data} />}
    </div>
  );
}
