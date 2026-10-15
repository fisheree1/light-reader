import { strToU8, zipSync } from 'fflate';

/** A minimal FictionBook 2 document with two sections and a TOC. */
export function createFb2Fixture(): Uint8Array {
  return strToU8(`<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description>
    <title-info>
      <author><first-name>Lu</first-name><last-name>Xun</last-name></author>
      <book-title>FB2 测试书</book-title>
      <lang>zh</lang>
    </title-info>
    <document-info><id>fb2-fixture</id></document-info>
    <publish-info><publisher>LightReader</publisher></publish-info>
  </description>
  <body>
    <section><title><p>第一章</p></title><p>第一章的正文内容。</p></section>
    <section><title><p>第二章</p></title><p>第二章包含关键词。</p></section>
  </body>
</FictionBook>`);
}

const onePixelPng = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

/** A comic book archive with two image pages. */
export function createCbzFixture(): Uint8Array {
  return zipSync({
    'page-01.png': onePixelPng,
    'page-02.png': onePixelPng,
    'ComicInfo.xml': strToU8('<ComicInfo />'),
  });
}

/** Bytes with the MOBI magic at offset 60; not a complete MOBI book. */
export function createMobiSignature(): Uint8Array {
  const bytes = new Uint8Array(128);
  bytes.set(strToU8('BOOKMOBI'), 60);
  return bytes;
}

export { onePixelPng };
