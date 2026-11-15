import * as RadixTabs from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';

export const Tabs = RadixTabs.Root;
export const TabsContent = RadixTabs.Content;

export function TabsList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <RadixTabs.List aria-label={label} className="flex gap-1 overflow-x-auto border-b border-border">
      {children}
    </RadixTabs.List>
  );
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <RadixTabs.Trigger
      value={value}
      className="-mb-px shrink-0 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-muted hover:text-fg data-[state=active]:border-primary data-[state=active]:text-fg"
    >
      {children}
    </RadixTabs.Trigger>
  );
}
