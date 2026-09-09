import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

export interface EmptyStateProps {
  action?: ReactNode;
  className?: string;
  description: string;
  icon?: ReactNode;
  title: string;
}

export function EmptyState({
  action,
  className,
  description,
  icon,
  title,
}: EmptyStateProps) {
  return (
    <section
      className={cn(
        'bg-surface flex min-h-56 flex-col items-center justify-center rounded-xl border p-8 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="bg-muted text-muted-foreground mb-4 flex size-11 items-center justify-center rounded-full">
          {icon}
        </div>
      ) : null}
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-muted-foreground mt-2 max-w-md text-sm leading-6">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </section>
  );
}
