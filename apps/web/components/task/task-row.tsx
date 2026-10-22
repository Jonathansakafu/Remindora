'use client';
import { Avatar, cn, PriorityFlag, TaskCheck } from '@remindora/ui';
import type { ProjectDTO, TaskDTO } from '@remindora/types';
import { Bell, CheckSquare, Lock, MessageSquare, Paperclip, Repeat, Star } from 'lucide-react';
import { memo } from 'react';
import { dueLabel } from '@/lib/dates';
import { useCompleteTask } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useUi } from '@/lib/ui-store';

const toneClass = { overdue: 'text-danger', today: 'text-cyan', soon: 'text-amber', later: 'text-ink-faint' } as const;

export const TaskRow = memo(function TaskRow({ task, project, showProject, members, compact, readOnly }: { task: TaskDTO; project?: ProjectDTO; showProject?: boolean; members?: Map<string, { name: string | null; email: string }>; compact?: boolean; readOnly?: boolean }) {
  const tz = useSession((s) => s.user?.timezone ?? 'UTC');
  const selected = useUi((s) => s.selectedTaskId === task.id);
  const inSelection = useUi((s) => s.selection.includes(task.id));
  const select = useUi((s) => s.selectTask);
  const toggleSelection = useUi((s) => s.toggleSelection);
  const complete = useCompleteTask();
  const done = !!task.completedAt;
  const due = dueLabel(task.dueAt, task.allDay, tz);
  const doneSubs = task.subtasks.filter((s) => s.done).length;
  const assignee = task.assigneeId ? members?.get(task.assigneeId) : undefined;
  const blocked = task.dependsOn.length > 0;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${task.title}${due ? `, due ${due.text}` : ''}${done ? ', completed' : ''}`}
      aria-pressed={selected}
      data-task-id={task.id}
      onClick={(e) => (e.metaKey || e.ctrlKey || e.shiftKey ? toggleSelection(task.id) : select(task.id))}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter') select(task.id);
        if (e.key === ' ' && !readOnly) {
          e.preventDefault();
          complete.mutate({ task, done: !done });
        }
        if (e.key === 'x') toggleSelection(task.id);
      }}
      className={cn(
        'group relative flex cursor-pointer items-start gap-3 rounded-2xl border border-transparent px-3 transition-[background,border-color,transform,opacity] duration-200 hover:bg-white/[0.035]',
        compact ? 'py-2' : 'py-2.5',
        selected && 'border-cyan/25 bg-cyan/[0.06]',
        inSelection && 'border-violet/40 bg-violet/[0.08]',
        done && 'opacity-55',
      )}
    >
      <div className="pt-0.5">
        <TaskCheck checked={done} priority={task.priority} label={`Complete ${task.title}`} disabled={readOnly || !!task.deletedAt} onChange={(next) => complete.mutate({ task, done: next })} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('truncate text-[14.5px] leading-6 text-ink', done && 'line-through decoration-ink-faint')}>{task.title}</span>
          {task.isFavorite && <Star size={12} className="shrink-0 fill-amber text-amber" aria-label="Favorite" />}
        </div>
        {!compact && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
            {due && <span className={cn('font-medium', !done && toneClass[due.tone])}>{due.text}</span>}
            {task.recurrence && <Repeat size={12} aria-label="Repeats" />}
            {task.reminders.some((r) => r.nextFireAt) && <Bell size={12} aria-label="Reminder set" />}
            {task.subtasks.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <CheckSquare size={12} /> {doneSubs}/{task.subtasks.length}
              </span>
            )}
            {task.commentCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <MessageSquare size={12} /> {task.commentCount}
              </span>
            )}
            {task.attachmentCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <Paperclip size={12} /> {task.attachmentCount}
              </span>
            )}
            {blocked && (
              <span className="inline-flex items-center gap-1" title="Has dependencies">
                <Lock size={11} /> blocked by {task.dependsOn.length}
              </span>
            )}
            {task.tags.map((t) => (
              <span key={t} className="text-violet">#{t}</span>
            ))}
            {showProject && project && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: project.color }} />
                {project.isInbox ? 'Inbox' : project.name}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        <PriorityFlag priority={task.priority} />
        {assignee && <Avatar name={assignee.name ?? assignee.email} size={22} />}
      </div>
    </div>
  );
});
