import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';

import type { BookQuoteReference } from '../domain/note';
import { BookQuoteNode } from './book-quote-node';
import { translate } from '../../../i18n/i18n';

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
    Placeholder.configure({
      placeholder: translate('notes.placeholder'),
    }),
    BookQuoteNode.configure(options),
  ];
}
