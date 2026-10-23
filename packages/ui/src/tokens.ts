/**
 * Remindora "midnight glass observatory" design tokens. Shared by web, desktop
 * (same web build) and the React Native app. Contrast ratios are AA against `bg`.
 */
export const colors = {
  bg: '#070D22',
  bgElevated: '#0B1330',
  surface: '#111C3E',
  surfaceHigh: '#182B58',
  border: 'rgba(168, 239, 255, 0.12)',
  borderStrong: 'rgba(168, 239, 255, 0.24)',
  text: '#E8F4FF',
  textMuted: '#A6BAD8',
  textFaint: '#7D92B4',
  cyan: '#60E9FF',
  violet: '#A58CFF',
  amber: '#FFBC5C',
  danger: '#FF7A93',
  success: '#7CF3B0',
} as const;

export const priorityMeta = {
  CRITICAL: { label: 'Critical', color: '#FF7A93', cssVar: 'var(--color-p-critical)', short: 'P0', rank: 4 },
  HIGH: { label: 'High', color: '#FFBC5C', cssVar: 'var(--color-p-high)', short: 'P1', rank: 3 },
  MEDIUM: { label: 'Medium', color: '#60E9FF', cssVar: 'var(--color-p-medium)', short: 'P2', rank: 2 },
  LOW: { label: 'Low', color: '#A58CFF', cssVar: 'var(--color-p-low)', short: 'P3', rank: 1 },
  NONE: { label: 'None', color: '#7D92B4', cssVar: 'var(--color-p-none)', short: '—', rank: 0 },
} as const;

/** Web: a translucent version of any colour, including theme variables (`var(--…)`). */
export function withAlpha(color: string, alpha: number): string {
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}

export type PriorityKey = keyof typeof priorityMeta;

export const projectPalette = ['#60E9FF', '#A58CFF', '#FFBC5C', '#7CF3B0', '#FF7A93', '#68BFFF', '#F5A3FF', '#9DEFFF'] as const;

export const radii = { sm: 8, md: 12, lg: 18, xl: 24 } as const;
