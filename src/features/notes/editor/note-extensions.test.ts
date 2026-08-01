import { Editor } from '@tiptap/core';

import { createNoteExtensions } from './note-extensions';

describe('note extensions', () => {
  it('parses and serializes Markdown through the official extension', () => {
    const editor = new Editor({
      extensions: createNoteExtensions({
        onNavigate: vi.fn(),
        resolveBookTitle: () => '测试书',
      }),
      content: '## Markdown 标题\n\n正文 **加粗**',
      contentType: 'markdown',
    });

    const json = editor.getJSON();
    expect(json.type).toBe('doc');
    expect(json.content.at(0)?.type).toBe('heading');
    expect(editor.getMarkdown()).toContain('## Markdown 标题');
    editor.destroy();
  });
});
