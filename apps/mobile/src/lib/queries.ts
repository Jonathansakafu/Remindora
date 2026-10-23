import type { HabitDTO, NotificationDTO, ProjectDTO, TaskDTO } from '@remindora/types';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { api, ApiError } from './api';
import { mutateOrQueue } from './offline';
import { pushTodayToWidget } from './widget-data';

export const keys = {
  tasks: (p: Record<string, unknown>) => ['tasks', p] as const,
  task: (id: string) => ['task', id] as const,
  projects: ['projects'] as const,
  notifications: ['notifications'] as const,
  habits: ['habits'] as const,
};

export function useTasks(params: { view?: string; projectId?: string; from?: string; to?: string }) {
  return useQuery({
    queryKey: keys.tasks(params),
    queryFn: async () => {
      const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as Array<[string, string]>).toString();
      const tasks = await api<TaskDTO[]>(`/tasks?${q}`);
      if (params.view === 'today') void pushTodayToWidget(tasks);
      return tasks;
    },
  });
}
export const useTask = (id: string) => useQuery({ queryKey: keys.task(id), queryFn: () => api<TaskDTO>(`/tasks/${id}`) });
export const useProjects = () => useQuery({ queryKey: keys.projects, queryFn: () => api<ProjectDTO[]>('/projects') });
export const useNotifications = () => useQuery({ queryKey: keys.notifications, queryFn: () => api<{ items: NotificationDTO[]; unread: number }>('/notifications?limit=50') });
export const useHabits = () => useQuery({ queryKey: keys.habits, queryFn: () => api<HabitDTO[]>('/habits') });

export function patchTask(qc: QueryClient, task: TaskDTO) {
  qc.setQueryData(keys.task(task.id), task);
  qc.setQueriesData<TaskDTO[]>({ queryKey: ['tasks'] }, (l) => l?.map((t) => (t.id === task.id ? task : t)));
}

export function refetchTasks(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['tasks'] });
}

export function showError(e: unknown) {
  if (e instanceof ApiError && e.status === 402) Alert.alert('Limit reached', e.message);
  else if (e instanceof ApiError && e.isNetwork) return;
  else Alert.alert('Something went wrong', e instanceof Error ? e.message : 'Please try again.');
}

export function useComplete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ task, done }: { task: TaskDTO; done: boolean }) => mutateOrQueue<TaskDTO>({ method: 'POST', path: `/tasks/${task.id}/${done ? 'complete' : 'reopen'}` }),
    onMutate: ({ task, done }) => patchTask(qc, { ...task, completedAt: done ? new Date().toISOString() : null }),
    onSettled: () => refetchTasks(qc),
    onError: showError,
  });
}

export function useUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ task, patch }: { task: TaskDTO; patch: Record<string, unknown> }) =>
      mutateOrQueue<TaskDTO>({ method: 'PATCH', path: `/tasks/${task.id}`, body: { ...patch, baseVersion: task.version }, entityKey: `task:${task.id}` }),
    onMutate: ({ task, patch }) => patchTask(qc, { ...task, ...(patch as Partial<TaskDTO>) }),
    onSuccess: (t) => t && patchTask(qc, t),
    onSettled: () => refetchTasks(qc),
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'edit_conflict') Alert.alert('Updated elsewhere', 'This task changed on another device. The newer values were kept.');
      else showError(e);
    },
  });
}
