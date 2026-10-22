'use client';
import { Badge, Button, Dialog, DialogContent, Field, GlassPanel, Input, Segmented, Select, Spinner } from '@remindora/ui';
import type { FilterQuery, TaskDTO } from '@remindora/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { PageHeader } from '@/components/views/common';
import { ListView } from '@/components/views/list-view';
import { api } from '@/lib/api';
import { keys, reportError, useFeature, useFilters, useProjects } from '@/lib/queries';

type Rule = FilterQuery['rules'][number];
const FIELDS: Array<{ value: Rule['field']; label: string; advanced?: boolean }> = [
  { value: 'priority', label: 'Priority' },
  { value: 'tag', label: 'Tag' },
  { value: 'project', label: 'List' },
  { value: 'due', label: 'Due' },
  { value: 'text', label: 'Text contains' },
  { value: 'assignee', label: 'Assignee', advanced: true },
  { value: 'status', label: 'Status', advanced: true },
];

function defaultRule(field: Rule['field']): Rule {
  switch (field) {
    case 'priority': return { field, op: 'in', value: ['HIGH'] };
    case 'tag': return { field, op: 'in', value: [] };
    case 'project': return { field, op: 'in', value: [] };
    case 'due': return { field, op: 'next7' };
    case 'text': return { field, op: 'contains', value: '' };
    case 'assignee': return { field, op: 'me', value: [] };
    case 'status': return { field, op: 'in', value: ['IN_PROGRESS'] };
  }
}

function RuleEditor({ rule, onChange, onRemove, advanced }: { rule: Rule; onChange: (r: Rule) => void; onRemove: () => void; advanced: boolean }) {
  const { data: projects = [] } = useProjects();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-bg-elevated/50 p-2">
      <Select aria-label="Field" className="h-8 w-auto text-xs" value={rule.field} onChange={(e) => onChange(defaultRule(e.target.value as Rule['field']))}>
        {FIELDS.map((f) => <option key={f.value} value={f.value} disabled={f.advanced && !advanced}>{f.label}{f.advanced && !advanced ? ' (Premium)' : ''}</option>)}
      </Select>
      {rule.field === 'priority' && (
        <>
          <Select aria-label="Operator" className="h-8 w-auto text-xs" value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value as 'in' })}><option value="in">is</option><option value="notIn" disabled={!advanced}>is not</option></Select>
          {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'] as const).map((p) => (
            <button key={p} type="button" aria-pressed={rule.value.includes(p)} onClick={() => onChange({ ...rule, value: rule.value.includes(p) ? rule.value.filter((x) => x !== p) : [...rule.value, p] })} className="h-7 rounded-lg border border-line px-2 text-xs aria-pressed:border-cyan aria-pressed:bg-cyan/15">{p.toLowerCase()}</button>
          ))}
        </>
      )}
      {rule.field === 'tag' && <Input aria-label="Tags (comma separated)" className="h-8 w-48 text-xs" value={rule.value.join(',')} onChange={(e) => onChange({ ...rule, value: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} placeholder="work, errands" />}
      {rule.field === 'project' && (
        <Select aria-label="List" className="h-8 w-auto text-xs" value={rule.value[0] ?? ''} onChange={(e) => onChange({ ...rule, value: e.target.value ? [e.target.value] : [] })}>
          <option value="">Choose…</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.isInbox ? 'Inbox' : p.name}</option>)}
        </Select>
      )}
      {rule.field === 'due' && (
        <Select aria-label="Due" className="h-8 w-auto text-xs" value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value as 'today' })}>
          <option value="overdue">is overdue</option><option value="today">today or earlier</option><option value="next7">in the next 7 days</option><option value="none">has no date</option>
        </Select>
      )}
      {rule.field === 'text' && <Input aria-label="Text" className="h-8 w-48 text-xs" value={rule.value} onChange={(e) => onChange({ ...rule, value: e.target.value })} />}
      {rule.field === 'assignee' && (
        <Select aria-label="Assignee" className="h-8 w-auto text-xs" value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value as 'me' })}><option value="me">is me</option><option value="none">is nobody</option></Select>
      )}
      {rule.field === 'status' && (
        <Select aria-label="Status" className="h-8 w-auto text-xs" value={rule.value[0]} onChange={(e) => onChange({ ...rule, value: [e.target.value] })}>
          {['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE'].map((s) => <option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>)}
        </Select>
      )}
      <button type="button" aria-label="Remove rule" onClick={onRemove} className="ml-auto rounded p-1 text-ink-faint hover:text-danger"><X size={14} /></button>
    </div>
  );
}

function FilterInner() {
  const params = useSearchParams();
  const id = params.get('id');
  const router = useRouter();
  const qc = useQueryClient();
  const advanced = useFeature('filters.advanced');
  const { data: filters = [] } = useFilters();
  const filter = filters.find((f) => f.id === id);
  const [editing, setEditing] = useState(params.get('new') === '1');
  const [name, setName] = useState('');
  const [query, setQuery] = useState<FilterQuery>({ match: 'all', rules: [defaultRule('priority')] });
  const { data: tasks = [], isLoading } = useQuery({ queryKey: ['filter-run', id], queryFn: () => api<TaskDTO[]>(`/filters/${id}/tasks`), enabled: !!id && !editing });
  const { data: preview = [] } = useQuery({ queryKey: ['filter-preview', JSON.stringify(query)], queryFn: () => api<TaskDTO[]>('/filters/preview', { body: query }), enabled: editing && query.rules.length > 0, retry: false });

  useEffect(() => {
    if (filter) {
      setName(filter.name);
      setQuery(filter.query as FilterQuery);
    }
  }, [filter]);

  async function save() {
    try {
      const saved = filter ? await api<{ id: string }>(`/filters/${filter.id}`, { method: 'PATCH', body: { name, query } }) : await api<{ id: string }>('/filters', { body: { name, query, pinned: true } });
      qc.invalidateQueries({ queryKey: keys.filters });
      qc.invalidateQueries({ queryKey: ['filter-run'] });
      setEditing(false);
      router.replace(`/app/filter?id=${saved.id}`);
    } catch (e) {
      reportError(e);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={filter?.name ?? 'New filter'}
        subtitle={filter?.advanced ? <Badge tone="amber">advanced</Badge> : 'Smart filter'}
        actions={
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>
            {filter && <Button size="sm" variant="danger" onClick={async () => { await api(`/filters/${filter.id}`, { method: 'DELETE' }).catch(reportError); qc.invalidateQueries({ queryKey: keys.filters }); router.replace('/app/today'); }}><Trash2 size={14} /></Button>}
          </div>
        }
      />
      <div className="px-1 md:px-5">
        {isLoading ? <Spinner /> : <ListView tasks={tasks} grouping="due" emptyTitle="No tasks match this filter" addDefaults={null} />}
      </div>
      <Dialog open={editing} onOpenChange={(o) => (setEditing(o), !o && !id && router.back())}>
        <DialogContent title={filter ? 'Edit filter' : 'New filter'} className="max-w-2xl">
          <div className="space-y-3">
            <Field label="Name" htmlFor="fname"><Input id="fname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Hot this week" /></Field>
            <Segmented label="Match" value={query.match} onChange={(m) => setQuery({ ...query, match: m })} options={[{ value: 'all', label: 'All rules' }, { value: 'any', label: 'Any rule', disabled: !advanced, title: advanced ? undefined : 'Premium' }]} />
            {query.rules.map((r, i) => (
              <RuleEditor key={i} rule={r} advanced={advanced} onChange={(nr) => setQuery({ ...query, rules: query.rules.map((x, j) => (j === i ? nr : x)) })} onRemove={() => setQuery({ ...query, rules: query.rules.filter((_, j) => j !== i) })} />
            ))}
            <Button size="sm" variant="ghost" disabled={!advanced && query.rules.length >= 2} onClick={() => setQuery({ ...query, rules: [...query.rules, defaultRule('due')] })}>
              <Plus size={14} /> Add rule {!advanced && query.rules.length >= 2 && <Sparkles size={12} className="text-amber" />}
            </Button>
            <GlassPanel className="max-h-48 overflow-y-auto p-3 text-sm">
              <p className="mb-1 text-xs text-ink-faint">{preview.length} matching tasks</p>
              {preview.slice(0, 8).map((t) => <p key={t.id} className="truncate">{t.title}</p>)}
            </GlassPanel>
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button><Button variant="primary" onClick={save} disabled={!name.trim() || !query.rules.length}>Save filter</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function FilterPage() {
  return <Suspense><FilterInner /></Suspense>;
}
