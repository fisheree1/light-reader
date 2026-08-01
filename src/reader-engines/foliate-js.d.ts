declare module 'foliate-js/view.js' {
  export {};
}

declare module 'foliate-js/overlayer.js' {
  export const Overlayer: {
    highlight(
      rects: Iterable<DOMRect>,
      options?: { color?: string },
    ): SVGGElement;
  };
}
