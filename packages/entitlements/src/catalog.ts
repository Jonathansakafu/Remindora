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

const FREE_FEATURES: FeatureKey[] = ['view.list', 'view.kanban', 'view.calendar', 'view.agenda', 'view.matrix', 'nlp', 'sync', 'widgets', 'themes', 'stats.basic', 'reminders.email'];

function features(enabled: readonly FeatureKey[]): Record<FeatureKey, boolean> {
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, enabled.includes(k)])) as Record<FeatureKey, boolean>;
}

export const PLAN_DEFAULTS: Record<PlanKey, PlanDefinition> = {
  FREE: {
    limits: {
      'lists.max': 9,
      'tasksPerList.max': 99,
      'attachmentsPerDay.max': 1,
      'checklistItemsPerTask.max': 19,
      'remindersPerTask.max': 2,
      'members.max': 2,
      'habits.max': 5,
      'countdowns.max': 5,
      'savedFilters.max': 3,
      'templates.max': 0,
    },
    features: features(FREE_FEATURES),
  },
  PREMIUM: {
    limits: {
      'lists.max': 299,
      'tasksPerList.max': 999,
      'attachmentsPerDay.max': 199,
      'checklistItemsPerTask.max': 199,
      'remindersPerTask.max': 5,
      'members.max': 29,
      'habits.max': 299,
      'countdowns.max': 299,
      'savedFilters.max': 100,
      'templates.max': 200,
    },
    features: features(FEATURE_KEYS),
  },
  TEAM: {
    limits: {
      'lists.max': 999,
      'tasksPerList.max': 999,
      'attachmentsPerDay.max': 499,
      'checklistItemsPerTask.max': 199,
      'remindersPerTask.max': 5,
      'members.max': 200,
      'habits.max': 299,
      'countdowns.max': 299,
      'savedFilters.max': 300,
      'templates.max': 500,
    },
    features: features(FEATURE_KEYS),
  },
};

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
