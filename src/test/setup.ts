import '@testing-library/jest-dom/vitest';

// JSDOM declares these geometry APIs but does not implement them. ProseMirror
// only needs deterministic empty geometry in component tests.
document.elementFromPoint = () => null;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});
