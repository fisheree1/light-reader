import { deflateSync, strToU8 } from 'fflate';

export interface StarDictFixture {
  dict: Uint8Array;
  idx: Uint8Array;
  ifo: Uint8Array;
  syn?: Uint8Array;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function uint16le(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, value >> 8);
}

/** Builds a DictZip file: gzip with an `RA` extra field and raw chunks. */
function dictZip(data: Uint8Array, chunkLength = 32): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += chunkLength) {
    chunks.push(deflateSync(data.subarray(offset, offset + chunkLength)));
  }
  const extra = concat([
    strToU8('RA'),
    uint16le(6 + chunks.length * 2),
    uint16le(1),
    uint16le(chunkLength),
    uint16le(chunks.length),
    ...chunks.map((chunk) => uint16le(chunk.length)),
  ]);
  const header = Uint8Array.of(0x1f, 0x8b, 0x08, 0x04, 0, 0, 0, 0, 0, 3);
  return concat([header, uint16le(extra.length), extra, ...chunks]);
}

/**
 * Creates a tiny StarDict (`sametypesequence=m` unless given) whose words
 * must already be sorted case-insensitively.
 */
export function createStarDictFixture(
  entries: [word: string, definition: string][],
  options: {
    name?: string;
    synonyms?: [synonym: string, index: number][];
    type?: string;
  } = {},
): StarDictFixture {
  const definitions = entries.map(([, definition]) => strToU8(definition));
  let offset = 0;
  const idx = concat(
    entries.flatMap(([word], index) => {
      const size = definitions[index]?.length ?? 0;
      const record = [
        strToU8(word),
        Uint8Array.of(0),
        uint32(offset),
        uint32(size),
      ];
      offset += size;
      return record;
    }),
  );
  const ifo = strToU8(
    [
      "StarDict's dict ifo file",
      'version=2.4.2',
      `bookname=${options.name ?? '测试词典'}`,
      `wordcount=${String(entries.length)}`,
      `idxfilesize=${String(idx.length)}`,
      `sametypesequence=${options.type ?? 'm'}`,
      '',
    ].join('\n'),
  );
  const syn = options.synonyms
    ? concat(
        options.synonyms.flatMap(([synonym, index]) => [
          strToU8(synonym),
          Uint8Array.of(0),
          uint32(index),
        ]),
      )
    : undefined;
  return { ifo, idx, dict: dictZip(concat(definitions)), syn };
}
