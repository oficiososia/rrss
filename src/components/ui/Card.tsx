import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border border-border bg-surface shadow-card', className)} {...props} />;
}

interface CardHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
  as?: 'h2' | 'h3';
}

export function CardHeader({ title, description, action, as: Heading = 'h2' }: CardHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div className="min-w-0">
        <Heading className="text-base">{title}</Heading>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...props} />;
}
