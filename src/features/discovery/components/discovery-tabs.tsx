import { useI18n } from '../../../i18n/use-i18n';
import type { MessageKey } from '../../../i18n/i18n';

export type DiscoveryTab = 'novels' | 'syosetu' | 'opds';

export function DiscoveryTabs({
  onChange,
  tab,
}: {
  onChange: (tab: DiscoveryTab) => void;
  tab: DiscoveryTab;
}) {
  const { t } = useI18n();
  const tabs: [DiscoveryTab, MessageKey][] = [
    ['novels', 'opds.tabNovels'],
    ['syosetu', 'syosetu.tab'],
    ['opds', 'opds.tabOpds'],
  ];
  return (
    <div
      aria-label={t('opds.tabs')}
      className="bg-muted mb-5 inline-flex gap-1 rounded-lg p-1"
      role="tablist"
    >
      {tabs.map(([value, label]) => (
        <button
          aria-selected={tab === value}
          className={
            tab === value
              ? 'bg-surface rounded-md px-3 py-1.5 text-sm font-medium shadow-sm'
              : 'text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5 text-sm'
          }
          key={value}
          onClick={() => {
            onChange(value);
          }}
          role="tab"
          type="button"
        >
          {t(label)}
        </button>
      ))}
    </div>
  );
}
