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

  it('maps a large note collection within a basic release budget', () => {
    const rows = Array.from({ length: 1_000 }, (_, index) => ({
      id: `note-${String(index)}`,
      title: `性能笔记 ${String(index)}`,
      content_json: JSON.stringify(validDocument),
      plain_text: '恢复内容',
      created_at: index,
      updated_at: index,
    }));
    const startedAt = performance.now();

    const notes = rows.map(mapNoteRecord);

    expect(notes).toHaveLength(1_000);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });
});
