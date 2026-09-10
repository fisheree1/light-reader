import { Navigate, type RouteObject } from 'react-router-dom';

import { LibraryPage } from '../../features/library/library-page';
import { SettingsPage } from '../../features/settings/settings-page';
import { AppLayout } from '../layout/app-layout';
import { RouteLoadingFallback } from './route-loading-fallback';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    hydrateFallbackElement: <RouteLoadingFallback />,
    children: [
      { index: true, element: <Navigate replace to="/library" /> },
      { path: 'library', element: <LibraryPage /> },
      {
        path: 'notes',
        lazy: async () => {
          const { NotesPage } = await import('../../features/notes/notes-page');
          return { Component: NotesPage };
        },
      },
      {
        path: 'search',
        lazy: async () => {
          const { SearchPage } =
            await import('../../features/search/search-page');
          return { Component: SearchPage };
        },
      },
      {
        path: 'research',
        lazy: async () => {
          const { ResearchPage } =
            await import('../../features/ai-agent/research/research-page');
          return { Component: ResearchPage };
        },
      },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate replace to="/library" /> },
    ],
  },
  {
    path: '/reader/:bookId',
    hydrateFallbackElement: <RouteLoadingFallback />,
    lazy: async () => {
      const { ReaderPage } = await import('../../features/reader/reader-page');
      return { Component: ReaderPage };
    },
  },
];
