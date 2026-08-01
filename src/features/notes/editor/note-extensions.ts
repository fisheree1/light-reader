import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';

import type { BookQuoteReference } from '../domain/note';
import { BookQuoteNode } from './book-quote-node';

interface NoteExtensionsOptions {
  onNavigate: (reference: BookQuoteReference) => void;
  resolveBookTitle: (bookId: string) => string;
}

export function createNoteExtensions(options: NoteExtensionsOptions) {
  return [
    StarterKit.configure({
      // Links are outside this slice and accepting arbitrary protocols would
      // require a separate sanitization and platform-opening policy.
      link: false,
      heading: { levels: [1, 2, 3] },
    }),
    Markdown.configure({
      markedOptions: { breaks: true },
    }),
    Placeholder.configure({
      placeholder: '写下想法，或从阅读器插入一段高亮引用…',
    }),
    BookQuoteNode.configure(options),
  ];
}
