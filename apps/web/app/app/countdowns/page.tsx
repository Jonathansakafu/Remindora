'use client';
import { Button, Dialog, DialogContent, EmptyState, Field, GlassPanel, Input, projectPalette } from '@remindora/ui';
import type { CountdownDTO } from '@remindora/types';
import { useQueryClient } from '@tanstack/react-query';
import { Hourglass, Plus, Trash2 } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { PageHeader } from '@/components/views/common';
import { api } from '@/lib/api';
import { fromLocalInput } from '@/lib/dates';
import { keys, reportError, useCountdowns, useEntitlements } from '@/lib/queries';
import { useSession } from '@/lib/session';

export default function CountdownsPage() {
  const { data: items = [] } = useCountdowns();
  const { data: ent } = useEntitlements();
  const tz = useSession((s) => s.user?.timezone ?? 'UTC');
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [color, setColor] = useState<string>(projectPalette[1]);
  const now = DateTime.now().setZone(tz).startOf('day');

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Countdowns" subtitle={ent ? `${items.length} of ${ent.limits['countdowns.max']}` : undefined} actions={<Button variant="primary" size="sm" onClick={() => setOpen(true)}><Plus size={15} /> New countdown</Button>} />
      <div className="px-4 md:px-8">
        {!items.length ? (
          <EmptyState icon={<Hourglass size={22} />} title="Count down to what matters" body="Launches, trips, birthdays — see the days ticking down." />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((c: CountdownDTO) => {
              const target = DateTime.fromISO(c.targetAt).setZone(tz);
              const daysLeft = Math.round(target.startOf('day').diff(now, 'days').days);
              return (
                <li key={c.id}>
                  <GlassPanel className="group relative overflow-hidden p-5">
                    <div aria-hidden className="absolute -right-8 -top-8 h-28 w-28 rounded-full blur-2xl" style={{ background: `${c.color}40` }} />
                    <div className="font-display text-5xl font-semibold tabular-nums" style={{ color: c.color }}>{Math.abs(daysLeft)}</div>
                    <div className="text-xs uppercase tracking-wider text-ink-faint">{daysLeft === 0 ? 'today' : daysLeft > 0 ? 'days to go' : 'days ago'}</div>
                    <div className="mt-3 font-medium">{c.title}</div>
                    <div className="text-xs text-ink-muted">{target.toFormat('cccc, d LLLL yyyy')}</div>
                    <button type="button" aria-label={`Delete ${c.title}`} onClick={async () => { await api(`/countdowns/${c.id}`, { method: 'DELETE' }).catch(reportError); qc.invalidateQueries({ queryKey: keys.countdowns }); }} className="absolute right-3 top-3 rounded-lg p-1.5 text-ink-faint opacity-0 hover:text-danger group-hover:opacity-100 focus:opacity-100">
                      <Trash2 size={14} />
                    </button>
                  </GlassPanel>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="New countdown">
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api('/countdowns', { body: { title, targetAt: fromLocalInput(date, tz).iso, color } });
                qc.invalidateQueries({ queryKey: keys.countdowns });
                setOpen(false);
                setTitle('');
                setDate('');
              } catch (err) {
                reportError(err);
              }
            }}
          >
            <Field label="Event" htmlFor="ctitle"><Input id="ctitle" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Product launch" /></Field>
            <Field label="Date" htmlFor="cdate"><Input id="cdate" type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <div className="flex gap-2" role="radiogroup" aria-label="Color">
              {projectPalette.map((c) => <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)} className="h-7 w-7 rounded-full aria-checked:ring-2 aria-checked:ring-ink aria-checked:ring-offset-2 aria-checked:ring-offset-surface" style={{ background: c }} />)}
            </div>
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="primary">Create</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
