import { mapNoteRecord } from './note-record';

const validDocument = {
  schemaVersion: 1,
  content: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: '恢复内容' }] },
    ],
  },
};

describe('mapNoteRecord', () => {
  it('restores canonical JSON into the domain model', () => {
    const note = mapNoteRecord({
      id: 'note-1',
      title: '恢复测试',
      content_json: JSON.stringify(validDocument),
      plain_text: '恢复内容',
      created_at: 1,
      updated_at: 2,
    });

    expect(note.document).toEqual(validDocument);
    expect(note.documentRecovered).toBe(false);
  });

  it('uses a safe empty document when persisted JSON is corrupt', () => {
    const note = mapNoteRecord({
      id: 'note-1',
      title: '损坏测试',
      content_json: '{broken',
      plain_text: '旧内容',
      created_at: 1,
      updated_at: 2,
    });

    expect(note.documentRecovered).toBe(true);
    expect(note.document.content.type).toBe('doc');
  });
});
