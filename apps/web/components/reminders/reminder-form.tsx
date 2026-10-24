'use client';
import { Button, cn, DialogContent, Dialog, Field, Input, Select, Spinner, Textarea } from '@remindora/ui';
import type { TaskDTO } from '@remindora/types';
import { useQueryClient } from '@tanstack/react-query';
import { ALARM_SOUNDS, CUSTOM_UNITS, customOffset, DEFAULT_ALARM_SOUND, normalizeAlarmSound, offsetLabel, REMIND_PRESETS, type AlarmSound, type CustomUnit } from '@remindora/core';
import { AlarmClock, Check, Play, Plus, X } from 'lucide-react';
import { DateTime } from 'luxon';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { previewAlarmSound } from '@/lib/alarm';
import { api } from '@/lib/api';
import { reportError } from '@/lib/queries';
import { REPEAT_OPTIONS, repeatFromRrule, useReminderForm, type RepeatValue } from '@/lib/reminder-form';
import { useSession } from '@/lib/session';

function defaults(tz: string, task: TaskDTO | null) {
  if (task?.dueAt) {
    const d = DateTime.fromISO(task.dueAt).setZone(tz);
    const offsets = task.reminders.filter((r) => !r.subtaskId && !r.at).map((r) => r.offsetMinutes ?? 0);
    return { title: task.title, notes: task.description ?? '', date: d.toISODate()!, time: d.toFormat('HH:mm'), repeat: repeatFromRrule(task.recurrence?.rrule), sound: normalizeAlarmSound(task.alarmSound), offsets: offsets.length ? [...new Set(offsets)].sort((a, b) => a - b) : [0] };
  }
  // Next full hour, so the default is always in the future.
  const next = DateTime.now().setZone(tz).plus({ hours: 1 }).startOf('hour');
  return { title: task?.title ?? '', notes: task?.description ?? '', date: next.toISODate()!, time: next.toFormat('HH:mm'), repeat: 'none' as RepeatValue, sound: DEFAULT_ALARM_SOUND as AlarmSound, offsets: [0] as number[] };
}

/** The "form to fill" for a reminder: what, when, how often. */
export function ReminderForm() {
  const { isOpen, editing, close } = useReminderForm();
  const tz = useSession((s) => s.user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const qc = useQueryClient();
  const [form, setForm] = useState(() => defaults(tz, null));
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState<{ amount: string; unit: CustomUnit }>({ amount: '3', unit: 'days' });
  const toggleOffset = (m: number) => setForm((f) => ({ ...f, offsets: f.offsets.includes(m) ? f.offsets.filter((x) => x !== m) : [...f.offsets, m].sort((a, b) => a - b) }));
  const addCustom = () => {
    const m = customOffset(Number(custom.amount), custom.unit);
    if (m !== null && !form.offsets.includes(m)) setForm((f) => ({ ...f, offsets: [...f.offsets, m].sort((a, b) => a - b) }));
  };

  useEffect(() => {
    if (isOpen) setForm(defaults(tz, editing));
  }, [isOpen, editing, tz]);

  const when = DateTime.fromISO(`${form.date}T${form.time}`, { zone: tz });
  const inPast = when.isValid && when < DateTime.now() && form.repeat === 'none';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !when.isValid) return;
    // Early reminders whose time has already passed would ring immediately: skip them.
    const now = DateTime.now();
    const offsets = form.offsets.filter((m) => m === 0 || when.minus({ minutes: m }) > now || form.repeat !== 'none');
    const skipped = form.offsets.filter((m) => !offsets.includes(m));
    if (!offsets.length) {
      toast.error('Pick when to be reminded');
      return;
    }
    setBusy(true);
    const rrule = REPEAT_OPTIONS.find((o) => o.value === form.repeat)!.rrule;
    const body = {
      title: form.title.trim(),
      description: form.notes.trim() || null,
      dueAt: when.toUTC().toISO(),
      allDay: false,
      alarmSound: form.sound,
      reminders: offsets.map((offsetMinutes) => ({ offsetMinutes })),
      recurrence: rrule ? { rrule } : null,
    };
    try {
      if (editing) await api(`/tasks/${editing.id}`, { method: 'PATCH', body });
      else await api('/tasks', { body: { ...body, description: body.description ?? undefined, recurrence: body.recurrence ?? undefined } });
      await qc.invalidateQueries({ queryKey: ['tasks'] });
      toast.success(`${editing ? 'Updated' : 'Reminder set'} for ${when.toFormat("ccc d LLL 'at' HH:mm")}`, skipped.length ? { description: `Skipped ${skipped.map(offsetLabel).join(', ')} — that time has already passed.` } : undefined);
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
          <fieldset>
            <legend className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-ink-faint">Remind me</legend>
            <div className="flex flex-wrap gap-2">
              {[...new Set([...REMIND_PRESETS.map((p) => p.minutes as number), ...form.offsets])].sort((a, b) => a - b).map((m) => {
                const on = form.offsets.includes(m);
                return (
                  <button key={m} type="button" role="checkbox" aria-checked={on} onClick={() => toggleOffset(m)} className={cn('inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition-colors', on ? 'border-cyan bg-cyan/15 text-cyan' : 'border-line text-ink-muted hover:border-line-strong hover:text-ink')}>
                    {on && <Check size={15} />} {offsetLabel(m)}
                    {on && !REMIND_PRESETS.some((p) => p.minutes === m) && <X size={14} aria-hidden />}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-ink-muted">Custom:</span>
              <Input aria-label="Custom amount" type="number" min={1} max={999} value={custom.amount} onChange={(e) => setCustom({ ...custom, amount: e.target.value })} className="h-10 w-20" />
              <Select aria-label="Custom unit" value={custom.unit} onChange={(e) => setCustom({ ...custom, unit: e.target.value as CustomUnit })} className="h-10 w-28">
                {CUSTOM_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </Select>
              <span className="text-ink-muted">early</span>
              <Button size="sm" variant="secondary" className="h-10" onClick={addCustom} disabled={customOffset(Number(custom.amount), custom.unit) === null}>
                <Plus size={15} /> Add
              </Button>
            </div>
          </fieldset>
          <Field label="Sound" htmlFor="rf-sound">
            <div className="flex gap-2">
              <Select id="rf-sound" value={form.sound} onChange={(e) => setForm({ ...form, sound: e.target.value as AlarmSound })} className="h-12 flex-1 text-base">
                {ALARM_SOUNDS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
              <Button size="lg" variant="secondary" className="h-12" onClick={() => previewAlarmSound(form.sound)} aria-label="Play this sound">
                <Play size={17} /> Play
              </Button>
            </div>
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
