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
