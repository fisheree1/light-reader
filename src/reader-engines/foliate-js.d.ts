declare module 'foliate-js/view.js' {
  /** Parsed book; narrowed by `FoliateBook` in foliate-book-loader.ts. */
  export function makeBook(file: File): Promise<unknown>;
}

declare module 'foliate-js/overlayer.js' {
  export const Overlayer: {
    highlight(
      rects: Iterable<DOMRect>,
      options?: { color?: string },
    ): SVGGElement;
  };
}

declare module 'foliate-js/dict.js' {
  export interface StarDictWord {
    data: [string, Uint8Array][];
    word: string;
  }

  export class StarDict {
    ifo: Record<string, string>;
    loadIfo(file: Blob): Promise<void>;
    loadIdx(file: Blob): Promise<void>;
    loadDict(
      file: Blob,
      inflate: (data: Uint8Array) => Uint8Array | Promise<Uint8Array>,
    ): Promise<void>;
    loadSyn(file?: Blob): Promise<void> | undefined;
    lookup(query: string): Promise<StarDictWord[]>;
    synonyms(query: string): Promise<StarDictWord[]>;
  }
}
