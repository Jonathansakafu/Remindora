import { GlassPanel } from '@remindora/ui';
import type { ReactNode } from 'react';

export function Section({ title, description, children, actions }: { title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <GlassPanel className="mb-4 p-5">
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </GlassPanel>
  );
}

export function SettingRow({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/60 py-3 first:border-t-0 first:pt-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-ink">{label}</div>
        {hint && <div className="text-xs text-ink-faint">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
