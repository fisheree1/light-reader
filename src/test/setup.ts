import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

import { getWebDatabase } from '../database/web/web-database';
import { setActiveLocale } from '../i18n/i18n';
import { useAppStore } from '../stores/app-store';

// Tests assert the Chinese interface unless they switch language explicitly.
beforeEach(() => {
  setActiveLocale('zh-CN');
  useAppStore.setState({ locale: 'zh-CN' });
});

// JSDOM declares these geometry APIs but does not implement them. ProseMirror
// only needs deterministic empty geometry in component tests.
document.elementFromPoint = () => null;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

afterEach(async () => {
  // Every test starts with an empty browser database.
  await getWebDatabase().close();
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});
