import { Editor } from '@tiptap/core';

import { createNoteExtensions } from './note-extensions';

function typeText(editor: Editor, text: string) {
  for (const character of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp('handleTextInput', (handler) =>
      handler(editor.view, from, to, character, () =>
        editor.state.tr.insertText(character, from, to),
      ),
    );
    if (!handled) {
      editor.view.dispatch(editor.state.tr.insertText(character, from, to));
    }
  }
}

describe('note extensions', () => {
  it('keeps Markdown shortcuts through StarterKit input rules', () => {
    const editor = new Editor({
      extensions: createNoteExtensions({
        onNavigate: vi.fn(),
        resolveBookTitle: () => '测试书',
      }),
    });

    typeText(editor, '## 标题');
    expect(editor.getJSON().content.at(0)).toMatchObject({
      type: 'heading',
      attrs: { level: 2 },
    });

    editor.commands.setContent('<p></p>');
    typeText(editor, '正文 **加粗** ');
    expect(JSON.stringify(editor.getJSON())).toContain('"type":"bold"');
    editor.destroy();
  });
});
