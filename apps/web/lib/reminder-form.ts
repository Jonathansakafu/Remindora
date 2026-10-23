'use client';
import type { TaskDTO } from '@remindora/types';
import { create } from 'zustand';

/** Opens the "New reminder" / "Edit reminder" form from anywhere (sidebar, + button, list). */
export const useReminderForm = create<{ isOpen: boolean; editing: TaskDTO | null; open: (task?: TaskDTO) => void; close: () => void }>((set) => ({
  isOpen: false,
  editing: null,
  open: (task) => set({ isOpen: true, editing: task ?? null }),
  close: () => set({ isOpen: false, editing: null }),
}));

export { REPEAT_OPTIONS, repeatFromRrule, repeatLabel, type RepeatValue } from '@remindora/core';
