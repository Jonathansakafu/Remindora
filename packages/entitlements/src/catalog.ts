import type { PlanKey } from '@remindora/types';

/**
 * Entitlement catalog. These are *seed defaults*: the server loads the live
 * values from the Entitlement table (cached briefly), so limits and features
 * can be changed — per plan or per user — without shipping an app update.
 */

export const LIMIT_KEYS = [
  'lists.max',
  'tasksPerList.max',
  'attachmentsPerDay.max',
  'checklistItemsPerTask.max',
  'remindersPerTask.max',
  'members.max',
  'habits.max',
  'countdowns.max',
  'savedFilters.max',
  'templates.max',
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

export const FEATURE_KEYS = [
  'view.list',
  'view.kanban',
  'view.calendar',
  'view.calendarMulti',
  'view.agenda',
  'view.matrix',
  'view.matrixAdvanced',
  'view.timeline',
  'nlp',
  'sync',
  'widgets',
  'themes',
  'stats.basic',
  'stats.premium',
  'reports',
  'integrations',
  'task.duration',
  'reminders.email',
  'reminders.constant',
  'reminders.checklist',
  'templates.custom',
  'history.full',
  'filters.advanced',
  'ai',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export interface PlanDefinition {
  limits: Record<LimitKey, number>;
  features: Record<FeatureKey, boolean>;
}

function features(enabled: readonly FeatureKey[]): Record<FeatureKey, boolean> {
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, enabled.includes(k)])) as Record<FeatureKey, boolean>;
}

/**
 * Remindora is completely free: every account gets every feature with generous
 * limits. Plan keys remain only so old data and per-user overrides keep working.
 */
const FULL_ACCESS: PlanDefinition = {
  limits: {
    'lists.max': 999,
    'tasksPerList.max': 9999,
    'attachmentsPerDay.max': 499,
    'checklistItemsPerTask.max': 199,
    'remindersPerTask.max': 10,
    'members.max': 200,
    'habits.max': 299,
    'countdowns.max': 299,
    'savedFilters.max': 300,
    'templates.max': 500,
  },
  features: features(FEATURE_KEYS),
};

export const PLAN_DEFAULTS: Record<PlanKey, PlanDefinition> = { FREE: FULL_ACCESS, PREMIUM: FULL_ACCESS, TEAM: FULL_ACCESS };

/** Human labels for upgrade prompts. */
export const LIMIT_LABELS: Record<LimitKey, string> = {
  'lists.max': 'lists',
  'tasksPerList.max': 'tasks in this list',
  'attachmentsPerDay.max': 'attachments today',
  'checklistItemsPerTask.max': 'checklist items on this task',
  'remindersPerTask.max': 'reminders on this task',
  'members.max': 'members',
  'habits.max': 'habits',
  'countdowns.max': 'countdowns',
  'savedFilters.max': 'saved filters',
  'templates.max': 'templates',
};
