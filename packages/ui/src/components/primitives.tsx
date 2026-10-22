'use client';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { X } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cn } from '../cn';

// ── Dialog ──
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ title, description, children, className, hideTitle }: { title: string; description?: string; children: ReactNode; className?: string; hideTitle?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#030719]/70 backdrop-blur-sm animate-fade" />
      <DialogPrimitive.Content
        className={cn('glass-strong fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 rounded-[22px] p-5 animate-rise focus:outline-none', className)}
      >
        <DialogPrimitive.Title className={cn('font-display text-lg font-semibold text-ink', hideTitle && 'sr-only')}>{title}</DialogPrimitive.Title>
        {description ? <DialogPrimitive.Description className="mt-1 text-sm text-ink-muted">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
        <div className={cn(!hideTitle && 'mt-4')}>{children}</div>
        <DialogPrimitive.Close className="absolute right-3 top-3 rounded-lg p-1.5 text-ink-faint hover:bg-white/5 hover:text-ink" aria-label="Close">
          <X size={16} />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Slide-over panel (right on desktop, bottom sheet on small screens). */
export function Sheet({ open, onOpenChange, title, children, side = 'right' }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode; side?: 'right' | 'bottom' | 'left' }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[#030719]/60 backdrop-blur-[2px] animate-fade" />
        <DialogPrimitive.Content
          className={cn(
            'glass-strong fixed z-40 flex flex-col overflow-hidden focus:outline-none animate-rise',
            side === 'right' && 'inset-y-0 right-0 w-full max-w-md rounded-l-[22px]',
            side === 'left' && 'inset-y-0 left-0 w-[85vw] max-w-xs rounded-r-[22px]',
            side === 'bottom' && 'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-[22px]',
          )}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ── Popover ──
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverContent = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>>(({ className, align = 'start', sideOffset = 6, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content ref={ref} align={align} sideOffset={sideOffset} className={cn('glass-strong z-50 rounded-2xl p-3 animate-rise focus:outline-none', className)} {...props} />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = 'PopoverContent';

// ── Dropdown ──
export const Menu = DropdownPrimitive.Root;
export const MenuTrigger = DropdownPrimitive.Trigger;
export const MenuContent = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>>(({ className, sideOffset = 6, ...props }, ref) => (
  <DropdownPrimitive.Portal>
    <DropdownPrimitive.Content ref={ref} sideOffset={sideOffset} className={cn('glass-strong z-50 min-w-44 rounded-xl p-1 animate-rise', className)} {...props} />
  </DropdownPrimitive.Portal>
));
MenuContent.displayName = 'MenuContent';
export const MenuItem = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof DropdownPrimitive.Item> & { danger?: boolean }>(({ className, danger, ...props }, ref) => (
  <DropdownPrimitive.Item
    ref={ref}
    className={cn('flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-white/8 data-[disabled]:opacity-40', danger ? 'text-danger' : 'text-ink', className)}
    {...props}
  />
));
MenuItem.displayName = 'MenuItem';
export const MenuSeparator = () => <DropdownPrimitive.Separator className="my-1 h-px bg-line" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => <DropdownPrimitive.Label className="px-2.5 py-1.5 text-[11px] uppercase tracking-wider text-ink-faint">{children}</DropdownPrimitive.Label>;

// ── Switch ──
export const Switch = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn('relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-line-strong bg-bg-elevated transition-colors data-[state=checked]:border-cyan/60 data-[state=checked]:bg-cyan/30 disabled:opacity-50', className)}
    {...props}
  >
    <SwitchPrimitive.Thumb className="block h-4.5 w-4.5 translate-x-0.5 rounded-full bg-ink-muted shadow transition-transform data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-cyan" />
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';

// ── Tabs ──
export const Tabs = TabsPrimitive.Root;
export const TabsList = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(({ className, ...props }, ref) => (
  <TabsPrimitive.List ref={ref} className={cn('inline-flex items-center gap-1 rounded-xl border border-line bg-bg-elevated/60 p-1', className)} {...props} />
));
TabsList.displayName = 'TabsList';
export const TabsTrigger = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn('inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm text-ink-muted transition-colors hover:text-ink data-[state=active]:bg-surface-high data-[state=active]:text-ink data-[state=active]:shadow-[0_0_0_1px_rgb(96_233_255/0.25)]', className)}
    {...props}
  />
));
TabsTrigger.displayName = 'TabsTrigger';
export const TabsContent = TabsPrimitive.Content;

// ── Tooltip ──
export const TooltipProvider = TooltipPrimitive.Provider;
export function Tooltip({ label, children, side = 'top' }: { label: ReactNode; children: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <TooltipPrimitive.Root delayDuration={350}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={6} className="z-50 rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink shadow-lg animate-fade">
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
