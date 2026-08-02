import { createEmptyNoteDocument, type Note } from '../domain/note';
import { LocalNoteDraftStorage } from './note-draft-storage';

function note(): Note {
  return {
    id: 'note-1',
    title: '数据库版本',
    document: createEmptyNoteDocument(),
    plainText: '',
    documentRecovered: false,
    createdAt: 1,
    updatedAt: 10,
  };
}

describe('LocalNoteDraftStorage', () => {
  it('recovers a crash journal only against the matching database version', () => {
    const storage = new LocalNoteDraftStorage();
    const persisted = note();
    storage.write(
      { ...persisted, title: '异常退出前输入' },
      persisted.updatedAt,
    );

    expect(storage.recover(persisted)).toMatchObject({
      id: persisted.id,
      title: '异常退出前输入',
    });
    expect(storage.recover({ ...persisted, updatedAt: 11 })).toBeNull();
  });

  it('ignores corrupt draft data without affecting the database note', () => {
    localStorage.setItem('light-reader-note-draft:note-1', '{broken');
    expect(new LocalNoteDraftStorage().recover(note())).toBeNull();
  });
});
