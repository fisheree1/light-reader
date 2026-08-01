import type { ReactNode } from 'react';

import { Button, type ButtonProps } from './button';

export interface IconButtonProps extends Omit<
  ButtonProps,
  'children' | 'size'
> {
  icon: ReactNode;
  label: string;
}

export function IconButton({ icon, label, ...props }: IconButtonProps) {
  return (
    <Button aria-label={label} size="icon" title={label} {...props}>
      {icon}
    </Button>
  );
}
