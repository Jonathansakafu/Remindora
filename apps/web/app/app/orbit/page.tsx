'use client';
import { Switch } from '@remindora/ui';
import { OrbitSummary } from '@/components/orbit/orbit-summary';
import { PageHeader } from '@/components/views/common';
import { useUi } from '@/lib/ui-store';

export default function OrbitPage() {
  const show3d = useUi((s) => s.show3d);
  const setShow3d = useUi((s) => s.setShow3d);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Orbit" subtitle="Your day at a glance. Tap a node to jump in." actions={<label className="flex items-center gap-2 text-sm text-ink-muted">3D <Switch checked={show3d} onCheckedChange={setShow3d} aria-label="Show 3D visualization" /></label>} />
      <div className="px-4 md:px-8">
        <OrbitSummary tall />
        <p className="mt-3 text-xs text-ink-faint">The 3D view pauses when off-screen and is replaced by a static summary when “reduce motion” is on.</p>
      </div>
    </div>
  );
}
