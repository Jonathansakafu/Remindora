'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ListViewKind = 'LIST' | 'KANBAN' | 'CALENDAR' | 'TIMELINE' | 'AGENDA' | 'MATRIX';
export type CalendarMode = 'day' | '3day' | 'week' | 'month' | 'multiweek' | 'year' | 'agenda';

interface UiState {
  selectedTaskId: string | null;
  quickAddOpen: boolean;
  paletteOpen: boolean;
  notificationsOpen: boolean;
  mobileNavOpen: boolean;
  selection: string[];
  viewByList: Record<string, ListViewKind>;
  calendarMode: CalendarMode;
  theme: 'observatory' | 'daybreak';
  motion: 'system' | 'reduced';
  show3d: boolean;
  selectTask: (id: string | null) => void;
  setQuickAdd: (o: boolean) => void;
  setPalette: (o: boolean) => void;
  setNotifications: (o: boolean) => void;
  setMobileNav: (o: boolean) => void;
  toggleSelection: (id: string) => void;
  clearSelection: () => void;
  setView: (list: string, v: ListViewKind) => void;
  setCalendarMode: (m: CalendarMode) => void;
  setTheme: (t: UiState['theme']) => void;
  setMotion: (m: UiState['motion']) => void;
  setShow3d: (v: boolean) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      selectedTaskId: null,
      quickAddOpen: false,
      paletteOpen: false,
      notificationsOpen: false,
      mobileNavOpen: false,
      selection: [],
      viewByList: {},
      calendarMode: 'week',
      theme: 'observatory',
      motion: 'system',
      show3d: true,
      selectTask: (selectedTaskId) => set({ selectedTaskId }),
      setQuickAdd: (quickAddOpen) => set({ quickAddOpen }),
      setPalette: (paletteOpen) => set({ paletteOpen }),
      setNotifications: (notificationsOpen) => set({ notificationsOpen }),
      setMobileNav: (mobileNavOpen) => set({ mobileNavOpen }),
      toggleSelection: (id) => set((s) => ({ selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] })),
      clearSelection: () => set({ selection: [] }),
      setView: (list, v) => set((s) => ({ viewByList: { ...s.viewByList, [list]: v } })),
      setCalendarMode: (calendarMode) => set({ calendarMode }),
      setTheme: (theme) => set({ theme }),
      setMotion: (motion) => set({ motion }),
      setShow3d: (show3d) => set({ show3d }),
    }),
    { name: 'remindora.ui', partialize: (s) => ({ viewByList: s.viewByList, calendarMode: s.calendarMode, theme: s.theme, motion: s.motion, show3d: s.show3d }) },
  ),
);
