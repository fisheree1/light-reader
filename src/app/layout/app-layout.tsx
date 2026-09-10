import {
  BookOpen,
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
import { useAppStore } from '../../stores/app-store';

const navigationItems = [
  { icon: BookOpen, label: '书架', to: '/library' },
  { icon: NotebookPen, label: '笔记', to: '/notes' },
  { icon: Search, label: '搜索', to: '/search' },
  { icon: Sparkles, label: '研究', to: '/research' },
  { icon: Settings, label: '设置', to: '/settings' },
] as const;

export function AppLayout() {
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
              <p className="truncate text-sm font-semibold">轻阅笔记</p>
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
            label={isNavigationExpanded ? '收起导航' : '展开导航'}
            onClick={toggleNavigation}
            variant="ghost"
          />
        </div>

        <nav aria-label="主导航" className="mt-7 flex flex-1 flex-col gap-1">
          {navigationItems.map(({ icon: Icon, label, to }) => (
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
          ))}
        </nav>

        <IconButton
          icon={theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
          label={theme === 'light' ? '切换到深色主题' : '切换到浅色主题'}
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
