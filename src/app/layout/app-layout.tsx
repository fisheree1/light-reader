import {
  BarChart3,
  BookOpen,
  Globe,
  Moon,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sparkles,
  Settings,
  Sun,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';

import { IconButton } from '../../components/ui/icon-button';
import { cn } from '../../lib/cn';
import type { MessageKey } from '../../i18n/i18n';
import { useI18n } from '../../i18n/use-i18n';
import { useAppStore } from '../../stores/app-store';

const navigationItems = [
  { icon: BookOpen, labelKey: 'app.navLibrary', to: '/library' },
  { icon: Globe, labelKey: 'discovery.title', to: '/discover' },
  { icon: NotebookPen, labelKey: 'app.navNotes', to: '/notes' },
  { icon: Search, labelKey: 'app.navSearch', to: '/search' },
  { icon: Sparkles, labelKey: 'app.navResearch', to: '/research' },
  { icon: BarChart3, labelKey: 'app.navStats', to: '/stats' },
  { icon: Settings, labelKey: 'app.navSettings', to: '/settings' },
] as const satisfies readonly {
  icon: unknown;
  labelKey: MessageKey;
  to: string;
}[];

export function AppLayout() {
  const { t } = useI18n();
  const isNavigationExpanded = useAppStore(
    (state) => state.isNavigationExpanded,
  );
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const toggleNavigation = useAppStore((state) => state.toggleNavigation);

  return (
    <div className="bg-background text-foreground flex h-screen overflow-hidden">
      <aside
        className={cn(
          'bg-surface flex h-full shrink-0 flex-col border-r px-3 py-4 transition-[width] duration-200',
          isNavigationExpanded ? 'w-52' : 'w-16',
        )}
      >
        <div className="flex h-10 items-center justify-between gap-2 px-1">
          {isNavigationExpanded ? (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{t('app.name')}</p>
              <p className="text-muted-foreground truncate text-xs">
                LightReader
              </p>
            </div>
          ) : null}
          <IconButton
            icon={
              isNavigationExpanded ? (
                <PanelLeftClose size={17} />
              ) : (
                <PanelLeftOpen size={17} />
              )
            }
            label={
              isNavigationExpanded
                ? t('app.collapseNavigation')
                : t('app.expandNavigation')
            }
            onClick={toggleNavigation}
            variant="ghost"
          />
        </div>

        <nav
          aria-label={t('app.mainNavigation')}
          className="mt-7 flex flex-1 flex-col gap-1"
        >
          {navigationItems.map(({ icon: Icon, labelKey, to }) => {
            const label = t(labelKey);
            return (
              <NavLink
                key={to}
                aria-label={isNavigationExpanded ? undefined : label}
                className={({ isActive }) =>
                  cn(
                    'flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors',
                    isActive
                      ? 'bg-muted text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    !isNavigationExpanded && 'justify-center px-0',
                  )
                }
                to={to}
              >
                <Icon aria-hidden="true" size={18} />
                {isNavigationExpanded ? <span>{label}</span> : null}
              </NavLink>
            );
          })}
        </nav>

        <IconButton
          icon={theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
          label={
            theme === 'light' ? t('app.useDarkTheme') : t('app.useLightTheme')
          }
          onClick={() => {
            setTheme(theme === 'light' ? 'dark' : 'light');
          }}
          variant="ghost"
        />
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl p-5 sm:p-7 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
