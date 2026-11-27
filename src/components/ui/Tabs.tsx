import * as RadixTabs from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const Tabs = RadixTabs.Root;
export const TabsContent = RadixTabs.Content;

export function TabsList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <RadixTabs.List
      aria-label={label}
      className="flex gap-0.5 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {children}
    </RadixTabs.List>
  );
}

export function TabsTrigger({
  value,
  children,
  onClick,
  className,
}: {
  value: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <RadixTabs.Trigger
      value={value}
      onClick={onClick}
      className={cn(
        '-mb-px shrink-0 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-muted hover:text-fg data-[state=active]:border-primary data-[state=active]:text-fg',
        className,
      )}
    >
      {children}
    </RadixTabs.Trigger>
  );
}
