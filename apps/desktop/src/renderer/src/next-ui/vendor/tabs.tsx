/** Adapted from shadcn/ui (MIT), commit c257f688cf4de7ec10cc1be84cad29cd4631182c.
 * Original: apps/v4/registry/new-york-v4/ui/tabs.tsx. See LICENSE-shadcn.txt.
 * Modifications: existing Radix dependency, ProjectOS semantic CSS, line variant by default.
 */
import type { ComponentProps } from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import clsx from 'clsx'
import './workbench-controls.css'

export function Tabs({ className, orientation = 'horizontal', ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" data-orientation={orientation} orientation={orientation} className={clsx('pui-tabs', className)} {...props} />
}

export function TabsList({ className, variant = 'line', ...props }: ComponentProps<typeof TabsPrimitive.List> & { variant?: 'line' | 'default' }) {
  return <TabsPrimitive.List data-slot="tabs-list" data-variant={variant} className={clsx('pui-tabs-list', className)} {...props} />
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger data-slot="tabs-trigger" className={clsx('pui-tabs-trigger', className)} {...props} />
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={clsx('pui-tabs-content', className)} {...props} />
}
