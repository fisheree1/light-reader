import type { DictionaryRepository } from '../../../database/repositories/dictionary-repository';
import type { DictionaryFileStorage } from '../../../storage/dictionary-file-storage';
import { createStarDictFixture } from '../../../test/fixtures/stardict-fixture';
import type { InstalledDictionary } from '../domain/dictionary';
import { DictionaryService } from './dictionary-service';

class MemoryRepository implements DictionaryRepository {
  items: InstalledDictionary[] = [];
  failSave = false;

  list() {
    return Promise.resolve([...this.items]);
  }

  save(dictionary: InstalledDictionary) {
    if (this.failSave) return Promise.reject(new Error('disk full'));
    this.items = [
      ...this.items.filter((item) => item.id !== dictionary.id),
      dictionary,
    ];
    return Promise.resolve(dictionary);
  }

  delete(id: string) {
    this.items = this.items.filter((item) => item.id !== id);
    return Promise.resolve();
  }
}

class MemoryFiles implements DictionaryFileStorage {
  files = new Map<string, Uint8Array>();

  write(id: string, fileName: string, data: Uint8Array) {
    this.files.set(`${id}/${fileName}`, data);
    return Promise.resolve();
  }

  read(id: string, fileName: string) {
    const data = this.files.get(`${id}/${fileName}`);
    return data
      ? Promise.resolve(data)
      : Promise.reject(new Error('missing file'));
  }

  remove(id: string, fileNames: readonly string[]) {
    for (const fileName of fileNames) this.files.delete(`${id}/${fileName}`);
    return Promise.resolve();
  }
}

const english = createStarDictFixture(
  [
    ['apple', 'n. 苹果'],
    ['book', 'n. 书；书籍'],
    ['read', 'v. 阅读'],
    ['study', 'v. 学习；研究'],
  ],
  {
    name: 'English–Chinese',
    synonyms: [
      ['bookish', 1],
      ['reading', 2],
    ],
  },
);

function sources(fixture = english, prefix = 'english') {
  return [
    { fileName: `${prefix}.ifo`, data: fixture.ifo },
    { fileName: `${prefix}.idx`, data: fixture.idx },
    { fileName: `${prefix}.dict.dz`, data: fixture.dict },
    ...(fixture.syn ? [{ fileName: `${prefix}.syn`, data: fixture.syn }] : []),
    { fileName: 'README.txt', data: new Uint8Array([1]) },
  ];
}

function setup() {
  const repository = new MemoryRepository();
  const files = new MemoryFiles();
  let id = 0;
  const service = new DictionaryService({
    files,
    repository,
    idGenerator: () => `dict-${String((id += 1))}`,
    now: () => 42,
  });
  return { files, repository, service };
}

describe('DictionaryService', () => {
  it('imports a real StarDict and looks up words, base forms, and synonyms', async () => {
    const { files, service } = setup();

    await expect(service.importDictionary(sources())).resolves.toEqual({
      id: 'dict-1',
      name: 'English–Chinese',
      wordCount: 4,
      typeSequence: 'm',
      hasSynonyms: true,
      sizeBytes: expect.any(Number) as number,
      createdAt: 42,
    });
    expect([...files.files.keys()].sort()).toEqual([
      'dict-1/dict.dict.dz',
      'dict-1/dict.idx',
      'dict-1/dict.ifo',
      'dict-1/dict.syn',
    ]);

    await expect(service.lookup('“Book,”')).resolves.toEqual({
      status: 'done',
      word: 'Book',
      entries: [
        {
          dictionaryId: 'dict-1',
          dictionaryName: 'English–Chinese',
          word: 'book',
          definition: 'n. 书；书籍',
        },
      ],
    });
    await expect(service.lookup('studies')).resolves.toMatchObject({
      entries: [{ word: 'study', definition: 'v. 学习；研究' }],
    });
    await expect(service.lookup('bookish')).resolves.toMatchObject({
      entries: [{ word: 'book' }],
    });
    await expect(service.lookup('zebra')).resolves.toEqual({
      status: 'done',
      word: 'zebra',
      entries: [],
    });
  });

  it('still finds words when a synonym index cannot be searched', async () => {
    const { service } = setup();
    await service.importDictionary(
      sources(
        createStarDictFixture(
          [
            ['book', '书'],
            ['pen', '笔'],
          ],
          { synonyms: [['bookish', 0]] },
        ),
      ),
    );

    await expect(service.lookup('book')).resolves.toMatchObject({
      entries: [{ word: 'book', definition: '书' }],
    });
  });

  it('reports missing dictionaries and unusable selections', async () => {
    const { service } = setup();

    await expect(service.lookup('book')).resolves.toEqual({
      status: 'no-dictionaries',
    });
    await expect(service.lookup('，，')).resolves.toEqual({
      status: 'invalid-selection',
    });
  });

  it('rejects incomplete, unsupported, or corrupt dictionaries', async () => {
    const { files, service } = setup();
    await expect(
      service.importDictionary(sources().slice(0, 2)),
    ).rejects.toMatchObject({
      code: 'DICTIONARY_INVALID',
    });
    const mixed = createStarDictFixture(
      [
        ['a', 'x'],
        ['b', 'y'],
      ],
      { type: 'tm' },
    );
    await expect(
      service.importDictionary(sources(mixed)),
    ).rejects.toMatchObject({ code: 'DICTIONARY_INVALID' });
    await expect(
      service.importDictionary([
        ...sources().filter((file) => !file.fileName.endsWith('.dz')),
        { fileName: 'broken.dict.dz', data: new Uint8Array([1, 2, 3]) },
      ]),
    ).rejects.toMatchObject({ code: 'DICTIONARY_INVALID' });
    expect(files.files.size).toBe(0);
  });

  it('removes written files when the registry cannot be saved', async () => {
    const { files, repository, service } = setup();
    repository.failSave = true;

    await expect(service.importDictionary(sources())).rejects.toMatchObject({
      code: 'DICTIONARY_WRITE_FAILED',
    });
    expect(files.files.size).toBe(0);
  });

  it('keeps results from readable dictionaries and removes dictionaries', async () => {
    const { files, service } = setup();
    const first = await service.importDictionary(sources());
    const second = await service.importDictionary(
      sources(
        createStarDictFixture(
          [
            ['book', '书'],
            ['pen', '笔'],
          ],
          { name: '简明' },
        ),
        'mini',
      ),
    );
    files.files.delete(`${second.id}/dict.idx`);

    await expect(service.lookup('book')).resolves.toMatchObject({
      entries: [{ dictionaryName: 'English–Chinese' }],
    });

    files.files.delete(`${first.id}/dict.idx`);
    const fresh = new DictionaryService({
      files,
      repository: {
        list: () => service.list(),
        save: vi.fn(),
        delete: vi.fn(),
      },
    });
    await expect(fresh.lookup('book')).rejects.toMatchObject({
      code: 'DICTIONARY_READ_FAILED',
    });

    await service.remove(first);
    await expect(service.list()).resolves.toEqual([second]);
    expect(
      [...files.files.keys()].some((key) => key.startsWith(first.id)),
    ).toBe(false);
  });
});
