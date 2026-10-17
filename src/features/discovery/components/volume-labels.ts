import type { MessageKey } from '../../../i18n/i18n';
import type { NovelVolume } from '../domain/catalog';
import type { ChineseScript } from '../domain/chinese-script';
import type { TranslationMethod, VolumeKind } from '../domain/edition';

export const methodKeys: Record<TranslationMethod, MessageKey> = {
  human: 'discovery.methodHuman',
  machine: 'discovery.methodMachine',
  mixed: 'discovery.methodMixed',
  unknown: 'discovery.methodUnknown',
};

const kindKeys: Partial<Record<VolumeKind, MessageKey>> = {
  main: 'discovery.kindMain',
  'side-story': 'discovery.kindSideStory',
  collection: 'discovery.kindCollection',
};

const scriptKeys: Partial<Record<ChineseScript, MessageKey>> = {
  hans: 'discovery.scriptHans',
  hant: 'discovery.scriptHant',
  mixed: 'discovery.scriptMixed',
};

/** A complete novel volume the app can fetch. */
export function isSelectable(volume: NovelVolume): boolean {
  return (
    volume.unavailableChapters === 0 &&
    volume.chapters.length > 0 &&
    volume.contentKind === 'novel'
  );
}

/** Short labels for a volume's kind, edition and script, when known. */
export function volumeBadges(
  volume: NovelVolume,
  t: (key: MessageKey) => string,
): string[] {
  const kind = kindKeys[volume.kind];
  const script = scriptKeys[volume.script];
  return [
    kind ? t(kind) : null,
    volume.edition,
    script ? t(script) : null,
  ].filter((label): label is string => label !== null);
}
