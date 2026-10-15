import { inflateSync } from 'fflate';

import type { DictionaryRepository } from '../../../database/repositories/dictionary-repository';
import { AppError, isAppError } from '../../../lib/app-error';
import { createUuid } from '../../../lib/id';
import type { DictionaryFileStorage } from '../../../storage/dictionary-file-storage';
import {
  classifyDictionaryFile,
  definitionToText,
  dictionaryFileNames,
  lookupCandidates,
  normalizeLookupText,
  parseStarDictInfo,
  type DictionaryEntry,
  type DictionaryFileKind,
  type InstalledDictionary,
} from '../domain/dictionary';

export const MAX_DICTIONARY_SIZE = 512 * 1024 * 1024;
const maxEntriesPerDictionary = 5;

export interface DictionarySourceFile {
  data: Uint8Array;
  fileName: string;
}

/** The subset of foliate-js `StarDict` used for lookups. */
export interface StarDictReader {
  lookup(
    query: string,
  ): Promise<{ data: [string, Uint8Array][]; word: string }[]>;
  synonyms(
    query: string,
  ): Promise<{ data: [string, Uint8Array][]; word: string }[]>;
}

export type StarDictLoader = (
  files: Record<'ifo' | 'idx' | 'dict', Uint8Array> & { syn?: Uint8Array },
) => Promise<StarDictReader>;

/** Loads a StarDict with foliate-js, inflating DictZip chunks with fflate. */
export const loadStarDict: StarDictLoader = async (files) => {
  const { StarDict } = await import('foliate-js/dict.js');
  const dictionary = new StarDict();
  const blob = (data: Uint8Array) => new Blob([Uint8Array.from(data)]);
  await dictionary.loadIfo(blob(files.ifo));
  await dictionary.loadIdx(blob(files.idx));
  await dictionary.loadDict(blob(files.dict), (data) => inflateSync(data));
  await dictionary.loadSyn(files.syn ? blob(files.syn) : undefined);
  return dictionary;
};

type StarDictWords = Awaited<ReturnType<StarDictReader['lookup']>>;

/** A malformed entry or index in one dictionary must not hide other results. */
async function safeLookup(
  lookup: () => Promise<StarDictWords>,
): Promise<StarDictWords> {
  try {
    return await lookup();
  } catch {
    return [];
  }
}

export type DictionaryLookupResult =
  | { status: 'invalid-selection' }
  | { status: 'no-dictionaries' }
  | { status: 'done'; word: string; entries: DictionaryEntry[] };

interface DictionaryServiceDependencies {
  files: DictionaryFileStorage;
  idGenerator?: () => string;
  load?: StarDictLoader;
  now?: () => number;
  repository: DictionaryRepository;
}

function storedFileNames(dictionary: InstalledDictionary): string[] {
  const names: string[] = [
    dictionaryFileNames.ifo,
    dictionaryFileNames.idx,
    dictionaryFileNames.dict,
  ];
  if (dictionary.hasSynonyms) names.push(dictionaryFileNames.syn);
  return names;
}

/**
 * Imports StarDict dictionaries into managed storage and looks up words
 * across every installed dictionary, entirely offline.
 */
export class DictionaryService {
  private readonly files: DictionaryFileStorage;
  private readonly idGenerator: () => string;
  private readonly load: StarDictLoader;
  private readonly loaded = new Map<string, Promise<StarDictReader>>();
  private readonly now: () => number;
  private readonly repository: DictionaryRepository;

  constructor(dependencies: DictionaryServiceDependencies) {
    this.files = dependencies.files;
    this.idGenerator = dependencies.idGenerator ?? createUuid;
    this.load = dependencies.load ?? loadStarDict;
    this.now = dependencies.now ?? Date.now;
    this.repository = dependencies.repository;
  }

  list(): Promise<InstalledDictionary[]> {
    return this.repository.list();
  }

  async importDictionary(
    sources: readonly DictionarySourceFile[],
  ): Promise<InstalledDictionary> {
    const byKind = new Map<DictionaryFileKind, Uint8Array>();
    for (const source of sources) {
      const kind = classifyDictionaryFile(source.fileName);
      if (kind) byKind.set(kind, source.data);
    }
    const ifo = byKind.get('ifo');
    const idx = byKind.get('idx');
    const dict = byKind.get('dict');
    const syn = byKind.get('syn');
    if (!ifo || !idx || !dict) throw new AppError('DICTIONARY_INVALID');
    const sizeBytes = [...byKind.values()].reduce(
      (total, data) => total + data.byteLength,
      0,
    );
    if (sizeBytes > MAX_DICTIONARY_SIZE) {
      throw new AppError('DICTIONARY_TOO_LARGE');
    }
    const info = parseStarDictInfo(new TextDecoder().decode(ifo));
    // foliate-js binary search needs at least two index entries.
    if (!info || info.wordCount < 2) throw new AppError('DICTIONARY_INVALID');
    try {
      await this.load({ ifo, idx, dict, syn });
    } catch (error) {
      throw new AppError('DICTIONARY_INVALID', { cause: error });
    }

    const dictionary: InstalledDictionary = {
      id: this.idGenerator(),
      name: info.name,
      wordCount: info.wordCount,
      typeSequence: info.typeSequence,
      hasSynonyms: syn !== undefined,
      sizeBytes,
      createdAt: this.now(),
    };
    const written: string[] = [];
    try {
      for (const [kind, data] of byKind) {
        const fileName = dictionaryFileNames[kind];
        await this.files.write(dictionary.id, fileName, data);
        written.push(fileName);
      }
      return await this.repository.save(dictionary);
    } catch (error) {
      await this.files.remove(dictionary.id, written).catch(() => undefined);
      if (isAppError(error)) throw error;
      throw new AppError('DICTIONARY_WRITE_FAILED', { cause: error });
    }
  }

  async remove(dictionary: InstalledDictionary): Promise<void> {
    await this.repository.delete(dictionary.id);
    this.loaded.delete(dictionary.id);
    // The registry is the source of truth; leftover files are harmless.
    await this.files
      .remove(dictionary.id, storedFileNames(dictionary))
      .catch(() => undefined);
  }

  async lookup(text: string): Promise<DictionaryLookupResult> {
    const word = normalizeLookupText(text);
    if (!word) return { status: 'invalid-selection' };
    const dictionaries = await this.repository.list();
    if (dictionaries.length === 0) return { status: 'no-dictionaries' };

    const candidates = lookupCandidates(word);
    const results = await Promise.allSettled(
      dictionaries.map((dictionary) => this.lookupIn(dictionary, candidates)),
    );
    const entries = results.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    );
    const failure = results.find((result) => result.status === 'rejected');
    // Only fail when no dictionary could be read at all.
    if (failure && results.every((result) => result.status === 'rejected')) {
      throw failure.reason;
    }
    return { status: 'done', word, entries };
  }

  private async lookupIn(
    dictionary: InstalledDictionary,
    candidates: readonly string[],
  ): Promise<DictionaryEntry[]> {
    const reader = await this.reader(dictionary);
    const seen = new Set<string>();
    const entries: DictionaryEntry[] = [];
    for (const candidate of candidates) {
      const words = [
        ...(await safeLookup(() => reader.lookup(candidate))),
        // Synonym indexes are optional and may be malformed independently.
        ...(await safeLookup(() => reader.synonyms(candidate))),
      ];
      for (const { word, data } of words) {
        for (const [, payload] of data) {
          const definition = definitionToText(dictionary.typeSequence, payload);
          const key = `${word}\u0000${definition}`;
          if (!definition || seen.has(key)) continue;
          seen.add(key);
          entries.push({
            dictionaryId: dictionary.id,
            dictionaryName: dictionary.name,
            word,
            definition,
          });
        }
      }
      if (entries.length) break;
    }
    return entries.slice(0, maxEntriesPerDictionary);
  }

  private reader(dictionary: InstalledDictionary): Promise<StarDictReader> {
    let reader = this.loaded.get(dictionary.id);
    if (!reader) {
      reader = (async () => {
        const read = (kind: DictionaryFileKind) =>
          this.files.read(dictionary.id, dictionaryFileNames[kind]);
        try {
          return await this.load({
            ifo: await read('ifo'),
            idx: await read('idx'),
            dict: await read('dict'),
            syn: dictionary.hasSynonyms ? await read('syn') : undefined,
          });
        } catch (error) {
          throw new AppError('DICTIONARY_READ_FAILED', { cause: error });
        }
      })();
      reader.catch(() => {
        this.loaded.delete(dictionary.id);
      });
      this.loaded.set(dictionary.id, reader);
    }
    return reader;
  }
}
