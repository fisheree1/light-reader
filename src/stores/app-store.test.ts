import { act } from '@testing-library/react';

import { useAppStore } from './app-store';

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState({ isNavigationExpanded: true, theme: 'light' });
  });

  it('changes and persists the theme', () => {
    act(() => {
      useAppStore.getState().setTheme('dark');
    });

    expect(useAppStore.getState().theme).toBe('dark');
    expect(localStorage.getItem('light-reader-app')).toContain('dark');
  });

  it('toggles navigation expansion', () => {
    act(() => {
      useAppStore.getState().toggleNavigation();
    });

    expect(useAppStore.getState().isNavigationExpanded).toBe(false);
  });
});
