import { Node } from '@tiptap/core';

import {
  bookQuoteReferenceSchema,
  type BookQuoteReference,
} from '../domain/note';

export interface BookQuoteNodeOptions {
  onNavigate: (reference: BookQuoteReference) => void;
  resolveBookTitle: (bookId: string) => string;
}

function parseReferenceElement(
  element: HTMLElement,
): BookQuoteReference | null {
  const value = element.dataset.bookQuote;
  if (!value) return null;
  try {
    return bookQuoteReferenceSchema.parse(JSON.parse(value));
  } catch {
    return null;
  }
}

function renderBookQuote(
  container: HTMLButtonElement,
  reference: BookQuoteReference,
  resolveBookTitle: (bookId: string) => string,
) {
  const quote = document.createElement('span');
  quote.className = 'line-clamp-4 text-sm leading-6';
  quote.textContent = `“${reference.quote}”`;

  const source = document.createElement('span');
  source.className = 'text-muted-foreground mt-2 block text-xs';
  const bookTitle = resolveBookTitle(reference.bookId);
  source.textContent = reference.chapter
    ? `《${bookTitle}》 · ${reference.chapter}`
    : `《${bookTitle}》`;

  container.replaceChildren(quote, source);
  container.setAttribute(
    'aria-label',
    `返回《${bookTitle}》中的引用：${reference.quote}`,
  );
}

export const BookQuoteNode = Node.create<BookQuoteNodeOptions>({
  name: 'bookQuote',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return {
      onNavigate: () => undefined,
      resolveBookTitle: () => '未知书籍',
    };
  },

  addAttributes() {
    return {
      bookId: { default: null },
      annotationId: { default: null },
      quote: { default: null },
      chapter: { default: null },
      locator: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'blockquote[data-book-quote]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          return parseReferenceElement(element) ?? false;
        },
      },
    ];
  },

  renderHTML({ node }) {
    const reference = bookQuoteReferenceSchema.safeParse(node.attrs);
    const data = reference.success ? JSON.stringify(reference.data) : '';
    return [
      'blockquote',
      {
        'data-book-quote': data,
        class: 'book-quote-node',
      },
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.contentEditable = 'false';
      button.className =
        'book-quote-node bg-muted hover:border-primary focus-visible:border-primary my-4 block w-full rounded-lg border-l-4 p-4 text-left transition-colors';

      let reference = bookQuoteReferenceSchema.safeParse(node.attrs);
      if (reference.success) {
        renderBookQuote(button, reference.data, this.options.resolveBookTitle);
      } else {
        button.disabled = true;
        button.textContent = '引用块数据损坏';
      }

      const handleClick = () => {
        if (reference.success) this.options.onNavigate(reference.data);
      };
      button.addEventListener('click', handleClick);

      return {
        dom: button,
        update: (nextNode) => {
          if (nextNode.type.name !== this.name) return false;
          reference = bookQuoteReferenceSchema.safeParse(nextNode.attrs);
          if (reference.success) {
            button.disabled = false;
            renderBookQuote(
              button,
              reference.data,
              this.options.resolveBookTitle,
            );
          } else {
            button.disabled = true;
            button.textContent = '引用块数据损坏';
          }
          return true;
        },
        destroy: () => {
          button.removeEventListener('click', handleClick);
        },
      };
    };
  },
});
