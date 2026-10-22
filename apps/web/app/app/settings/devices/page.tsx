'use client';
import { Badge, Button, Input, Spinner } from '@remindora/ui';
import type { DeviceDTO } from '@remindora/types';
import { useQueryClient } from '@tanstack/react-query';
import { Globe, Laptop, LogOut, Monitor, Pencil, QrCode, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Section } from '@/components/settings/section';
import { api } from '@/lib/api';
import { relative } from '@/lib/dates';
import { keys, reportError, useDevices } from '@/lib/queries';

const ICON: Record<string, React.ElementType> = { WEB: Globe, DESKTOP_MACOS: Laptop, DESKTOP_WINDOWS: Monitor, DESKTOP_LINUX: Monitor, ANDROID: Smartphone, IOS: Smartphone };
const OS: Record<string, string> = { WEB: 'Web', DESKTOP_MACOS: 'macOS', DESKTOP_WINDOWS: 'Windows', DESKTOP_LINUX: 'Linux', ANDROID: 'Android', IOS: 'iOS', UNKNOWN: 'Unknown' };

function DeviceRow({ d }: { d: DeviceDTO }) {
  const qc = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(d.name);
  const Icon = ICON[d.platform] ?? Monitor;
  return (
    <li className="flex flex-wrap items-center gap-3 border-t border-line/60 py-3 first:border-t-0">
      <span className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-bg-elevated text-cyan"><Icon size={18} /></span>
      <div className="min-w-0 flex-1">
        {renaming ? (
          <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); await api(`/devices/${d.id}`, { method: 'PATCH', body: { name } }).catch(reportError); setRenaming(false); qc.invalidateQueries({ queryKey: keys.devices }); }}>
            <Input aria-label="Device name" value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-56" autoFocus />
            <Button size="sm" type="submit">Save</Button>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{d.name}</span>
            {d.current && <Badge tone="cyan">This device</Badge>}
            {d.pushEnabled && <Badge tone="success">push</Badge>}
            {!d.sessionId && <Badge>signed out</Badge>}
          </div>
        )}
        <div className="text-xs text-ink-faint">{OS[d.platform]}{d.osVersion ? ` · ${d.osVersion}` : ''}{d.appVersion ? ` · v${d.appVersion}` : ''} · active {relative(d.lastActiveAt)} · linked {relative(d.createdAt)}</div>
      </div>
      <Button size="icon-sm" variant="ghost" aria-label={`Rename ${d.name}`} onClick={() => setRenaming((v) => !v)}><Pencil size={14} /></Button>
      {!d.current && (
        <Button
          size="sm"
          variant="danger"
          onClick={async () => {
            if (!confirm(`Sign out and remove “${d.name}”? It will need to be linked again.`)) return;
            try {
              await api(`/devices/${d.id}`, { method: 'DELETE' });
              toast.success(`${d.name} was signed out`);
              qc.invalidateQueries({ queryKey: keys.devices });
            } catch (e) {
              reportError(e);
            }
          }}
        >
          <LogOut size={14} /> Revoke
        </Button>
      )}
    </li>
  );
}

export default function DevicesPage() {
  const { data: devices, isLoading } = useDevices();
  const qc = useQueryClient();
  return (
    <Section
      title="Linked devices"
      description="Every device signed in to your account. Revoking signs it out immediately."
      actions={
        <div className="flex gap-2">
          <Link href="/app/settings/link-device"><Button size="sm" variant="primary"><QrCode size={14} /> Link a new device</Button></Link>
          {devices && devices.length > 1 && (
            <Button size="sm" variant="ghost" onClick={async () => { if (!confirm('Sign out every other device?')) return; await api('/devices/revoke-others', { method: 'POST' }).catch(reportError); qc.invalidateQueries({ queryKey: keys.devices }); }}>
              Sign out others
            </Button>
          )}
        </div>
      }
    >
      {isLoading ? <Spinner /> : <ul>{devices?.map((d) => <DeviceRow key={d.id} d={d} />)}</ul>}
    </Section>
  );
}
