'use client';
import { Badge, Button, EmptyState, Select } from '@remindora/ui';
import { useQueryClient } from '@tanstack/react-query';
import { LayoutTemplate, Sparkles, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Section } from '@/components/settings/section';
import { api } from '@/lib/api';
import { keys, reportError, scheduleTaskRefetch, useFeature, useProjects, useTemplates, useWorkspaces } from '@/lib/queries';

export default function TemplatesPage() {
  const entitled = useFeature('templates.custom');
  const { data: templates = [] } = useTemplates();
  const { data: projects = [] } = useProjects();
  const { data: workspaces = [] } = useWorkspaces();
  const [target, setTarget] = useState<Record<string, string>>({});
  const qc = useQueryClient();
  const router = useRouter();

  if (!entitled && !templates.length) {
    return <EmptyState icon={<LayoutTemplate size={22} />} title="Custom templates are Premium" body="Save any task or list — checklist, sections and all — and reuse it in one click." action={<Link href="/app/settings/billing"><Button variant="amber"><Sparkles size={15} /> See Premium</Button></Link>} />;
  }
  return (
    <Section title="Templates" description="Create them from any task or list via its “…” menu → Save as template.">
      {!templates.length && <p className="text-sm text-ink-faint">No templates yet.</p>}
      <ul className="space-y-2">
        {templates.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3">
            <Badge tone={t.kind === 'PROJECT' ? 'violet' : 'cyan'}>{t.kind === 'PROJECT' ? 'list' : 'task'}</Badge>
            <div className="min-w-0 flex-1"><div className="text-sm font-medium">{t.name}</div>{t.description && <div className="text-xs text-ink-faint">{t.description}</div>}</div>
            <Select aria-label={`Where to apply ${t.name}`} className="h-8 w-44 text-xs" value={target[t.id] ?? ''} onChange={(e) => setTarget({ ...target, [t.id]: e.target.value })}>
              {t.kind === 'TASK' ? (
                <>{projects.map((p) => <option key={p.id} value={p.id}>{p.isInbox ? 'Inbox' : p.name}</option>)}</>
              ) : (
                <>{workspaces.map((w) => <option key={w.id} value={w.isPersonal ? '' : w.id}>{w.isPersonal ? 'Personal' : w.name}</option>)}</>
              )}
            </Select>
            <Button
              size="sm"
              variant="primary"
              disabled={!entitled}
              onClick={async () => {
                try {
                  const body = t.kind === 'TASK' ? { projectId: target[t.id] || projects.find((p) => p.isInbox)?.id } : { workspaceId: target[t.id] || undefined };
                  const out = await api<{ id: string }>(`/templates/${t.id}/apply`, { body });
                  scheduleTaskRefetch(qc);
                  qc.invalidateQueries({ queryKey: keys.projects });
                  toast.success('Created from template');
                  if (t.kind === 'PROJECT') router.push(`/app/project?id=${out.id}`);
                } catch (e) {
                  reportError(e);
                }
              }}
            >
              Use
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={`Delete ${t.name}`} onClick={() => api(`/templates/${t.id}`, { method: 'DELETE' }).then(() => qc.invalidateQueries({ queryKey: keys.templates })).catch(reportError)}><Trash2 size={14} /></Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
