import {
  mutualPairs,
  simplifiedOnlyPairs,
  traditionalOnlyPairs,
} from './chinese-script-tables';

export type ChineseScript = 'hans' | 'hant' | 'mixed' | 'unknown';

function addPairs(
  map: Map<string, string>,
  pairs: string,
  reverse = false,
): Map<string, string> {
  const characters = Array.from(pairs);
  for (let index = 0; index + 1 < characters.length; index += 2) {
    const [from, to] = reverse
      ? [characters[index + 1], characters[index]]
      : [characters[index], characters[index + 1]];
    map.set(from, to);
  }
  return map;
}

let tables:
  | { toTraditional: Map<string, string>; toSimplified: Map<string, string> }
  | undefined;

function getTables() {
  tables ??= {
    toTraditional: addPairs(
      addPairs(new Map(), mutualPairs),
      simplifiedOnlyPairs,
    ),
    toSimplified: addPairs(
      addPairs(new Map(), mutualPairs, true),
      traditionalOnlyPairs,
    ),
  };
  return tables;
}

function convert(value: string, map: Map<string, string>): string {
  let result = '';
  for (const character of value) result += map.get(character) ?? character;
  return result;
}

/** Character-level conversion; phrase-level regional wording is not changed. */
export function toTraditional(value: string): string {
  return convert(value, getTables().toTraditional);
}

export function toSimplified(value: string): string {
  return convert(value, getTables().toSimplified);
}

/**
 * Guesses the script from characters that exist in only one script. Shared
 * characters carry no evidence, so short or neutral text stays `unknown`.
 */
export function detectChineseScript(value: string): ChineseScript {
  const { toTraditional: simplifiedOnly, toSimplified: traditionalOnly } =
    getTables();
  let simplified = 0;
  let traditional = 0;
  for (const character of value) {
    if (simplifiedOnly.has(character)) simplified += 1;
    else if (traditionalOnly.has(character)) traditional += 1;
  }
  const evidence = simplified + traditional;
  if (evidence < 2) return 'unknown';
  if (simplified / evidence >= 0.8) return 'hans';
  if (traditional / evidence >= 0.8) return 'hant';
  return 'mixed';
}

/**
 * Query spellings to try at a source: the query as typed, then the other
 * script when it differs. At most two, to keep requests to the source low.
 */
export function searchQueryVariants(query: string): string[] {
  const typed = query.trim();
  // Prefer the simplified spelling when the query has traditional characters.
  const simplified = toSimplified(typed);
  if (simplified !== typed) return [typed, simplified];
  const traditional = toTraditional(typed);
  return traditional === typed ? [typed] : [typed, traditional];
}

/**
 * A comparison key for titles from different sites: simplified characters,
 * NFKC width folding, case folding, and no punctuation, spaces or brackets.
 */
export function normalizeTitleKey(title: string): string {
  return toSimplified(title.normalize('NFKC'))
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\p{Z}]/gu, '');
}
