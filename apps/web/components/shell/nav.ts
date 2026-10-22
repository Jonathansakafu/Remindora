import { Archive, BarChart3, Bell, CalendarDays, CalendarRange, CheckCheck, Clock, Flame, Grid2x2, Hourglass, Inbox, Orbit, Search, Star, Sun, Target, Trash2, UserCheck, AlertTriangle } from 'lucide-react';

export const primaryNav = [
  { href: '/app/inbox', label: 'Inbox', icon: Inbox, slug: 'inbox' },
  { href: '/app/today', label: 'Today', icon: Sun, slug: 'today' },
  { href: '/app/upcoming', label: 'Upcoming', icon: CalendarRange, slug: 'upcoming' },
  { href: '/app/calendar', label: 'Calendar', icon: CalendarDays, slug: 'calendar' },
  { href: '/app/focus', label: 'Focus', icon: Target, slug: 'focus' },
  { href: '/app/habits', label: 'Habits', icon: Flame, slug: 'habits' },
  { href: '/app/analytics', label: 'Analytics', icon: BarChart3, slug: 'analytics' },
] as const;

export const secondaryNav = [
  { href: '/app/overdue', label: 'Overdue', icon: AlertTriangle, slug: 'overdue' },
  { href: '/app/assigned', label: 'Assigned to me', icon: UserCheck, slug: 'assigned' },
  { href: '/app/favorites', label: 'Favorites', icon: Star, slug: 'favorites' },
  { href: '/app/matrix', label: 'Eisenhower Matrix', icon: Grid2x2, slug: 'matrix' },
  { href: '/app/countdowns', label: 'Countdowns', icon: Hourglass, slug: 'countdowns' },
  { href: '/app/orbit', label: 'Orbit view', icon: Orbit, slug: 'orbit' },
  { href: '/app/completed', label: 'Completed', icon: CheckCheck, slug: 'completed' },
  { href: '/app/archive', label: 'Archive', icon: Archive, slug: 'archive' },
  { href: '/app/trash', label: 'Trash', icon: Trash2, slug: 'trash' },
] as const;

export const mobileTabs = [
  { href: '/app/today', label: 'Today', icon: Sun },
  { href: '/app/inbox', label: 'Inbox', icon: Inbox },
  { href: '/app/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/app/focus', label: 'Focus', icon: Clock },
] as const;

export const utilityIcons = { Search, Bell };

export const SMART_LISTS = ['inbox', 'today', 'upcoming', 'overdue', 'assigned', 'completed', 'favorites', 'archive', 'trash'] as const;
export type SmartListKey = (typeof SMART_LISTS)[number];

export const smartListMeta: Record<SmartListKey, { title: string; empty: string }> = {
  inbox: { title: 'Inbox', empty: 'Capture anything with Quick Add — sort it later.' },
  today: { title: 'Today', empty: 'Nothing due today. Enjoy the clear sky.' },
  upcoming: { title: 'Upcoming', empty: 'The next 7 days are open.' },
  overdue: { title: 'Overdue', empty: 'Nothing overdue — nicely done.' },
  assigned: { title: 'Assigned to me', empty: 'No tasks assigned to you.' },
  completed: { title: 'Completed', empty: 'Completed tasks will appear here.' },
  favorites: { title: 'Favorites', empty: 'Star tasks to keep them close.' },
  archive: { title: 'Archive', empty: 'Archived tasks live here.' },
  trash: { title: 'Trash', empty: 'Trash is empty. Deleted tasks are kept for 30 days.' },
};
