'use client';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  AnalyticsSummaryDTO,
  CommentDTO,
  CountdownDTO,
  DeviceDTO,
  EntitlementsDTO,
  HabitDTO,
  NotificationDTO,
  NotificationPreferenceDTO,
  ProjectDTO,
  SavedFilterDTO,
  TaskDTO,
  TemplateDTO,
  UserDTO,
  WorkspaceDTO,
  MemberDTO,
  ActivityDTO,
  AttachmentDTO,
} from '@remindora/types';
import { toast } from 'sonner';
import { api, ApiError } from './api';
import { mutateOrQueue } from './offline';
import { useSession } from './session';

export type TaskParams = { view?: string; projectId?: string; q?: string; includeCompleted?: boolean; from?: string; to?: string; tags?: string[]; priorities?: string[] };

export const keys = {
  me: ['me'] as const,
  workspaces: ['workspaces'] as const,
  projects: ['projects'] as const,
  tasks: (p: TaskParams) => ['tasks', p] as const,
  task: (id: string) => ['task', id] as const,
  calendar: (from: string, to: string, view: string) => ['calendar', from, to, view] as const,
  notifications: ['notifications'] as const,
  prefs: ['prefs'] as const,
  devices: ['devices'] as const,
  entitlements: ['entitlements'] as const,
  habits: ['habits'] as const,
  countdowns: ['countdowns'] as const,
  filters: ['filters'] as const,
  templates: ['templates'] as const,
  tags: ['tags'] as const,
};

const signedIn = () => useSession.getState().status === 'signed_in';

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => api<UserDTO & { requireDeviceApproval: boolean }>('/auth/me'), enabled: signedIn() });
}
export function useWorkspaces() {
  return useQuery({ queryKey: keys.workspaces, queryFn: () => api<WorkspaceDTO[]>('/workspaces') });
}
export function useProjects() {
  return useQuery({ queryKey: keys.projects, queryFn: () => api<ProjectDTO[]>('/projects') });
}
export function useTasks(params: TaskParams, enabled = true) {
  return useQuery({ queryKey: keys.tasks(params), queryFn: () => api<TaskDTO[]>('/tasks', { query: params }), enabled });
}
export function useTask(id: string | null) {
  return useQuery({ queryKey: keys.task(id ?? ''), queryFn: () => api<TaskDTO>(`/tasks/${id}`), enabled: !!id });
}
export function useEntitlements() {
  return useQuery({ queryKey: keys.entitlements, queryFn: () => api<EntitlementsDTO>('/me/entitlements'), staleTime: 60_000 });
}
export function useFeature(feature: string): boolean {
  const { data } = useEntitlements();
  return data?.features[feature] === true;
}
export function useNotifications() {
  return useQuery({ queryKey: keys.notifications, queryFn: () => api<{ items: NotificationDTO[]; unread: number }>('/notifications', { query: { limit: 60 } }) });
}
export function usePrefs() {
  return useQuery({ queryKey: keys.prefs, queryFn: () => api<NotificationPreferenceDTO>('/notifications/preferences') });
}
export function useDevices() {
  return useQuery({ queryKey: keys.devices, queryFn: () => api<DeviceDTO[]>('/devices') });
}
export function useHabits() {
  return useQuery({ queryKey: keys.habits, queryFn: () => api<HabitDTO[]>('/habits') });
}
export function useCountdowns() {
  return useQuery({ queryKey: keys.countdowns, queryFn: () => api<CountdownDTO[]>('/countdowns') });
}
export function useFilters() {
  return useQuery({ queryKey: keys.filters, queryFn: () => api<SavedFilterDTO[]>('/filters') });
}
export function useTemplates() {
  return useQuery({ queryKey: keys.templates, queryFn: () => api<TemplateDTO[]>('/templates') });
}
export function useTags() {
  return useQuery({ queryKey: keys.tags, queryFn: () => api<Array<{ name: string; color: string; count: number }>>('/tags') });
}
export function useMembers(workspaceId: string | null | undefined) {
  return useQuery({ queryKey: ['members', workspaceId], queryFn: () => api<MemberDTO[]>(`/workspaces/${workspaceId}/members`), enabled: !!workspaceId });
}
export function useComments(taskId: string) {
  return useQuery({ queryKey: ['comments', taskId], queryFn: () => api<CommentDTO[]>(`/tasks/${taskId}/comments`) });
}
export function useActivity(taskId: string) {
  return useQuery({ queryKey: ['activity', taskId], queryFn: () => api<{ events: ActivityDTO[]; truncated: boolean }>(`/tasks/${taskId}/activity`) });
}
export function useAttachments(taskId: string) {
  return useQuery({ queryKey: ['attachments', taskId], queryFn: () => api<AttachmentDTO[]>(`/tasks/${taskId}/attachments`) });
}
export function useAnalytics(from?: string, to?: string) {
  return useQuery({ queryKey: ['analytics', from, to], queryFn: () => api<AnalyticsSummaryDTO>('/analytics/summary', { query: { from, to } }) });
}

// ── Cache helpers ──

/** Applies an updated task to every cached list and detail. */
export function patchTaskCaches(qc: QueryClient, task: TaskDTO) {
  qc.setQueryData(keys.task(task.id), task);
  qc.setQueriesData<TaskDTO[]>({ queryKey: ['tasks'] }, (list) => (list ? list.map((t) => (t.id === task.id ? task : t)) : list));
}

export function removeTaskFromCaches(qc: QueryClient, taskId: string) {
  qc.setQueriesData<TaskDTO[]>({ queryKey: ['tasks'] }, (list) => (list ? list.filter((t) => t.id !== taskId) : list));
}

let refetchTimer: ReturnType<typeof setTimeout> | null = null;
/** Coalesces list refetches (membership of smart lists can change after an edit). */
export function scheduleTaskRefetch(qc: QueryClient) {
  if (refetchTimer) clearTimeout(refetchTimer);
  refetchTimer = setTimeout(() => {
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['calendar'] });
    qc.invalidateQueries({ queryKey: keys.projects });
  }, 250);
}

export function reportError(e: unknown, fallback = 'Something went wrong') {
  if (e instanceof ApiError) {
    if (e.isPlanGate) {
      toast(e.message, { description: 'Remindora Premium lifts this limit.', action: { label: 'See plans', onClick: () => (window.location.href = '/app/settings/billing') } });
      return;
    }
    if (e.isNetwork) {
      toast('Saved offline — will sync when you’re back online');
      return;
    }
    toast.error(e.message);
    return;
  }
  toast.error(fallback);
}

// ── Task mutations (optimistic, offline-capable) ──

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ task, patch }: { task: TaskDTO; patch: Record<string, unknown> }) =>
      mutateOrQueue<TaskDTO>({ method: 'PATCH', path: `/tasks/${task.id}`, body: { ...patch, baseVersion: task.version }, entityKey: `task:${task.id}` }),
    onMutate: ({ task, patch }) => patchTaskCaches(qc, { ...task, ...(patch as Partial<TaskDTO>) }),
    onSuccess: (updated) => {
      if (updated) patchTaskCaches(qc, updated);
      scheduleTaskRefetch(qc);
    },
    onError: (e, { task }) => {
      if (e instanceof ApiError && e.code === 'edit_conflict') {
        const d = e.details as { fields: string[]; server: TaskDTO };
        patchTaskCaches(qc, d.server);
        toast.warning('Changed on another device', { description: `Kept the newer ${d.fields.join(', ')}. Your other changes were saved.` });
        return;
      }
      patchTaskCaches(qc, task);
      reportError(e);
    },
  });
}

export function useCompleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ task, done }: { task: TaskDTO; done: boolean }) => mutateOrQueue<TaskDTO>({ method: 'POST', path: `/tasks/${task.id}/${done ? 'complete' : 'reopen'}`, entityKey: `task:${task.id}:status` }),
    onMutate: ({ task, done }) => patchTaskCaches(qc, { ...task, completedAt: done ? new Date().toISOString() : null, status: done ? 'DONE' : 'TODO' }),
    onSuccess: () => scheduleTaskRefetch(qc),
    onError: (e, { task }) => {
      patchTaskCaches(qc, task);
      reportError(e);
    },
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Record<string, unknown>) => mutateOrQueue<TaskDTO>({ method: 'POST', path: '/tasks', body: { clientId: crypto.randomUUID(), ...input } }),
    onSuccess: () => scheduleTaskRefetch(qc),
    onError: (e) => reportError(e),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (task: TaskDTO) => mutateOrQueue({ method: 'DELETE', path: `/tasks/${task.id}` }),
    onMutate: (task) => removeTaskFromCaches(qc, task.id),
    onSuccess: (_d, task) => {
      scheduleTaskRefetch(qc);
      toast('Moved to Trash', { action: { label: 'Undo', onClick: () => api(`/tasks/${task.id}/restore`, { method: 'POST' }).then(() => scheduleTaskRefetch(qc)) } });
    },
    onError: (e) => {
      scheduleTaskRefetch(qc);
      reportError(e);
    },
  });
}
