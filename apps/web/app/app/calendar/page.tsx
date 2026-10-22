'use client';
import { CalendarView } from '@/components/views/calendar-view';
import { PageHeader } from '@/components/views/common';

export default function Page() {
  return (
    <div>
      <PageHeader title="Calendar" subtitle="Drag tasks to schedule and time-block. Times shown in your timezone." />
      <CalendarView />
    </div>
  );
}
