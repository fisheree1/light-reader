export interface BookLocator {
  chapterHref?: string;
  cfi?: string;
  progression?: number;
}

/** Contract shared by future EPUB or PDF reader engine adapters. */
export interface EbookReader {
  open(source: ArrayBuffer): Promise<void>;
  goTo(locator: BookLocator): Promise<void>;
  getCurrentLocator(): Promise<BookLocator>;
  close(): Promise<void>;
}
