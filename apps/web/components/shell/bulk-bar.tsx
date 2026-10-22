'use client';
import { Button, Select } from '@remindora/ui';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCheck, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { reportError, scheduleTaskRefetch, useProjects } from '@/lib/queries';
import { useUi } from '@/lib/ui-store';

export function BulkBar() {
  const selection = useUi((s) => s.selection);
  const clear = useUi((s) => s.clearSelection);
  const { data: projects = [] } = useProjects();
  const qc = useQueryClient();
  if (!selection.length) return null;

  async function run(action: string, extra: Record<string, unknown> = {}) {
    try {
      const res = await api<{ succeeded: number }>('/tasks/bulk', { body: { ids: selection, action, ...extra } });
      toast.success(`${res.succeeded} of ${selection.length} updated`);
      clear();
      scheduleTaskRefetch(qc);
    } catch (e) {
      reportError(e);
    }
  }

  return (
    <div role="toolbar" aria-label="Bulk actions" className="glass-strong fixed bottom-24 left-1/2 z-30 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-2xl px-3 py-2 animate-rise md:bottom-6">
      <span className="px-1 text-sm text-ink">{selection.length} selected</span>
      <Button size="sm" onClick={() => run('complete')}>
        <CheckCheck size={14} /> Complete
      </Button>
      <Select aria-label="Set priority" className="h-8 w-auto text-xs" value="" onChange={(e) => e.target.value && run('priority', { priority: e.target.value })}>
        <option value="">Priority…</option>
        {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'].map((p) => (
          <option key={p} value={p}>{p.toLowerCase()}</option>
        ))}
      </Select>
      <Select aria-label="Move to list" className="h-8 w-auto text-xs" value="" onChange={(e) => e.target.value && run('move', { projectId: e.target.value })}>
        <option value="">Move to…</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.isInbox ? 'Inbox' : p.name}</option>
        ))}
      </Select>
      <Button size="sm" variant="danger" onClick={() => run('delete')}>
        <Trash2 size={14} /> Delete
      </Button>
      <button type="button" onClick={clear} className="rounded-lg p-1.5 text-ink-faint hover:bg-white/5" aria-label="Clear selection">
        <X size={15} />
      </button>
    </div>
  );
}
