import { Navigate, type RouteObject } from 'react-router-dom';

import { LibraryPage } from '../../features/library/library-page';
import { SettingsPage } from '../../features/settings/settings-page';
import { AppLayout } from '../layout/app-layout';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
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
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate replace to="/library" /> },
    ],
  },
  {
    path: '/reader/:bookId',
    lazy: async () => {
      const { ReaderPage } = await import('../../features/reader/reader-page');
      return { Component: ReaderPage };
    },
  },
];
