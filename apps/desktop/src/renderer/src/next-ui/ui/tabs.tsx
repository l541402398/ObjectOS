import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '../cn'

export const Tabs = TabsPrimitive.Root

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('inline-flex items-center gap-0.5 rounded-[10px] border border-[var(--pui-border)] bg-[var(--pui-surface-muted)] p-[3px]', className)}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex h-6 items-center gap-1.5 rounded-[7px] px-2.5 text-[12px] text-[var(--pui-ink-muted)] outline-none transition-colors hover:text-[var(--pui-ink)] focus-visible:ring-2 focus-visible:ring-[var(--pui-accent-soft)] data-[state=active]:bg-[var(--pui-surface-strong)] data-[state=active]:text-[var(--pui-ink)] data-[state=active]:shadow-[0_2px_8px_-6px_rgba(20,45,85,.5)]',
      className,
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('outline-none data-[state=active]:pui-motion-fade', className)}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName
