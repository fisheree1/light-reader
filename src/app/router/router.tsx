import { createBrowserRouter, createMemoryRouter } from 'react-router-dom';

import { routes } from './routes';

export const appRouter = createBrowserRouter(routes);

export function createTestRouter(initialEntries: string[] = ['/']) {
  return createMemoryRouter(routes, { initialEntries });
}
