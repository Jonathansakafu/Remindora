'use client';
import { Button, DialogContent, Dialog, Field, Input, Select, Spinner, Textarea } from '@remindora/ui';
import type { TaskDTO } from '@remindora/types';
import { useQueryClient } from '@tanstack/react-query';
import { AlarmClock } from 'lucide-react';
import { DateTime } from 'luxon';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { reportError } from '@/lib/queries';
import { REPEAT_OPTIONS, repeatFromRrule, useReminderForm, type RepeatValue } from '@/lib/reminder-form';
import { useSession } from '@/lib/session';

function defaults(tz: string, task: TaskDTO | null) {
  if (task?.dueAt) {
    const d = DateTime.fromISO(task.dueAt).setZone(tz);
    return { title: task.title, notes: task.description ?? '', date: d.toISODate()!, time: d.toFormat('HH:mm'), repeat: repeatFromRrule(task.recurrence?.rrule) };
  }
  // Next full hour, so the default is always in the future.
  const next = DateTime.now().setZone(tz).plus({ hours: 1 }).startOf('hour');
  return { title: task?.title ?? '', notes: task?.description ?? '', date: next.toISODate()!, time: next.toFormat('HH:mm'), repeat: 'none' as RepeatValue };
}

/** The "form to fill" for a reminder: what, when, how often. */
export function ReminderForm() {
  const { isOpen, editing, close } = useReminderForm();
  const tz = useSession((s) => s.user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const qc = useQueryClient();
  const [form, setForm] = useState(() => defaults(tz, null));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isOpen) setForm(defaults(tz, editing));
  }, [isOpen, editing, tz]);

  const when = DateTime.fromISO(`${form.date}T${form.time}`, { zone: tz });
  const inPast = when.isValid && when < DateTime.now() && form.repeat === 'none';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !when.isValid) return;
    setBusy(true);
    const rrule = REPEAT_OPTIONS.find((o) => o.value === form.repeat)!.rrule;
    const body = {
      title: form.title.trim(),
      description: form.notes.trim() || null,
      dueAt: when.toUTC().toISO(),
      allDay: false,
      recurrence: rrule ? { rrule } : null,
    };
    try {
      if (editing) await api(`/tasks/${editing.id}`, { method: 'PATCH', body });
      else await api('/tasks', { body: { ...body, description: body.description ?? undefined, recurrence: body.recurrence ?? undefined } });
      await qc.invalidateQueries({ queryKey: ['tasks'] });
      toast.success(`${editing ? 'Updated' : 'Reminder set'} for ${when.toFormat("ccc d LLL 'at' HH:mm")}`);
      close();
    } catch (err) {
      reportError(err, 'Couldn’t save the reminder');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && close()}>
      <DialogContent title={editing ? 'Edit reminder' : 'New reminder'} description="Fill in what you want to be reminded about. It will ring like an alarm at that time.">
        <form onSubmit={submit} className="space-y-4">
          <Field label="What should I remind you about?" htmlFor="rf-title">
            <Input id="rf-title" autoFocus required maxLength={200} placeholder="e.g. Take medicine, Call mom, Pay rent" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="h-12 text-base" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" htmlFor="rf-date">
              <Input id="rf-date" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="h-12 text-base" />
            </Field>
            <Field label="Time" htmlFor="rf-time">
              <Input id="rf-time" type="time" required value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className="h-12 text-base" />
            </Field>
          </div>
          <Field label="Repeat" htmlFor="rf-repeat">
            <Select id="rf-repeat" value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value as RepeatValue })} className="h-12 text-base">
              {REPEAT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes (optional)" htmlFor="rf-notes">
            <Textarea id="rf-notes" rows={2} maxLength={2000} placeholder="Anything else to remember" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          {inPast && <p className="text-sm text-amber">That time has already passed today — pick a later time or another day.</p>}
          <div className="flex gap-2 pt-1">
            <Button variant="ghost" size="lg" className="flex-1" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="lg" className="flex-[2]" disabled={busy || !form.title.trim() || inPast}>
              {busy ? <Spinner className="text-on-accent" /> : (<><AlarmClock size={18} /> {editing ? 'Save changes' : 'Set reminder'}</>)}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
