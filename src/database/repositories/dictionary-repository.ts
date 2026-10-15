import type { InstalledDictionary } from '../../features/dictionary/domain/dictionary';

export interface DictionaryRepository {
  delete(id: string): Promise<void>;
  list(): Promise<InstalledDictionary[]>;
  save(dictionary: InstalledDictionary): Promise<InstalledDictionary>;
}
