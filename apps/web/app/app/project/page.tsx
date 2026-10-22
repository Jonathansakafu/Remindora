import { Suspense } from 'react';
import { ProjectPage } from '@/components/pages/project';

export default function Page() {
  return (
    <Suspense>
      <ProjectPage />
    </Suspense>
  );
}
