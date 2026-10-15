import { z } from 'zod';

/** StarDict files LightReader stores for each installed dictionary. */
export const dictionaryFileNames = {
  ifo: 'dict.ifo',
  idx: 'dict.idx',
  dict: 'dict.dict.dz',
  syn: 'dict.syn',
} as const;

export type DictionaryFileKind = keyof typeof dictionaryFileNames;

/** Single-type StarDict sequences whose payload is readable as text. */
const supportedTypes = ['m', 't', 'y', 'h', 'g', 'x'] as const;

export const installedDictionarySchema = z.object({
  id: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(200),
  wordCount: z.number().int().nonnegative(),
  typeSequence: z.enum(supportedTypes),
  hasSynonyms: z.boolean(),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
});

export type InstalledDictionary = z.infer<typeof installedDictionarySchema>;

export interface DictionaryEntry {
  definition: string;
  dictionaryId: string;
  dictionaryName: string;
  word: string;
}

export interface StarDictInfo {
  name: string;
  typeSequence: InstalledDictionary['typeSequence'];
  wordCount: number;
}

/** Reads the `.ifo` header and rejects layouts the reader cannot decode. */
export function parseStarDictInfo(text: string): StarDictInfo | null {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== "StarDict's dict ifo file") return null;
  const fields = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const separator = line.indexOf('=');
    if (separator > 0) {
      fields.set(line.slice(0, separator).trim(), line.slice(separator + 1));
    }
  }
  const type = fields.get('sametypesequence')?.trim();
  const name = fields.get('bookname')?.trim();
  if (!name || !type || !supportedTypes.some((value) => value === type)) {
    return null;
  }
  return {
    name: name.slice(0, 200),
    typeSequence: type as StarDictInfo['typeSequence'],
    wordCount: Math.max(
      0,
      Number.parseInt(fields.get('wordcount') ?? '0', 10) || 0,
    ),
  };
}

/** Classifies selected files by StarDict role, ignoring anything else. */
export function classifyDictionaryFile(
  fileName: string,
): DictionaryFileKind | null {
  const name = fileName.toLowerCase();
  if (name.endsWith('.ifo')) return 'ifo';
  if (name.endsWith('.idx')) return 'idx';
  if (name.endsWith('.dict.dz')) return 'dict';
  if (name.endsWith('.syn')) return 'syn';
  return null;
}

const maxLookupLength = 64;

/**
 * Turns a text selection into a dictionary query: trims surrounding
 * punctuation and whitespace and rejects sentence-length selections.
 */
export function normalizeLookupText(text: string): string | null {
  const word = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '');
  if (!word || word.length > maxLookupLength) return null;
  if (word.split(' ').length > 4) return null;
  return word;
}

/** The query plus simple English base forms, most specific first. */
export function lookupCandidates(word: string): string[] {
  const candidates = [word, word.toLocaleLowerCase()];
  if (/^[a-z]+$/i.test(word)) {
    const lower = word.toLowerCase();
    const rules: [RegExp, string][] = [
      [/ies$/, 'y'],
      [/ied$/, 'y'],
      [/(ss|sh|ch|x|z)es$/, '$1'],
      [/([^s])s$/, '$1'],
      [/(.)\1ed$/, '$1'],
      [/ed$/, ''],
      [/ed$/, 'e'],
      [/(.)\1ing$/, '$1'],
      [/ing$/, ''],
      [/ing$/, 'e'],
    ];
    for (const [pattern, replacement] of rules) {
      if (pattern.test(lower)) {
        const base = lower.replace(pattern, replacement);
        if (base.length >= 2) candidates.push(base);
      }
    }
  }
  return [...new Set(candidates)];
}

const maxDefinitionLength = 20_000;

/**
 * Decodes a definition payload as plain text. Markup types (HTML, Pango,
 * XDXF) are reduced to text so dictionary content never becomes live DOM.
 */
export function definitionToText(
  type: InstalledDictionary['typeSequence'],
  data: Uint8Array,
): string {
  const raw = new TextDecoder().decode(data);
  let text = raw;
  if (type === 'h' || type === 'g' || type === 'x') {
    const withBreaks = raw
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|blockquote|h\d)>/gi, '\n');
    const document = new DOMParser().parseFromString(withBreaks, 'text/html');
    text = document.body.textContent;
  }
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxDefinitionLength);
}
