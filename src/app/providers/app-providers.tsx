import * as Tooltip from '@radix-ui/react-tooltip';
import { useEffect, type PropsWithChildren } from 'react';

import { useAppStore } from '../../stores/app-store';

export function AppProviders({ children }: PropsWithChildren) {
  const theme = useAppStore((state) => state.theme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
  }, [theme]);

  return <Tooltip.Provider delayDuration={350}>{children}</Tooltip.Provider>;
}
