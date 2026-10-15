import type { ReaderDisplaySettings } from '../domain/reader-settings';
import { useI18n } from '../../../i18n/use-i18n';

interface ReaderSettingsFormProps {
  disabled?: boolean;
  idPrefix: string;
  onChange: (value: ReaderDisplaySettings) => void;
  value: ReaderDisplaySettings;
}

interface RangeFieldProps {
  disabled: boolean;
  id: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  suffix: string;
  value: number;
}

function RangeField({
  disabled,
  id,
  label,
  max,
  min,
  onChange,
  step,
  suffix,
  value,
}: RangeFieldProps) {
  return (
    <div className="block">
      <span className="flex items-center justify-between text-sm font-medium">
        <label htmlFor={id}>{label}</label>
        <output
          aria-live="polite"
          className="text-muted-foreground tabular-nums"
        >
          {value}
          {suffix}
        </output>
      </span>
      <input
        className="accent-primary mt-2 w-full"
        disabled={disabled}
        id={id}
        max={max}
        min={min}
        onChange={(event) => {
          onChange(event.currentTarget.valueAsNumber);
        }}
        step={step}
        type="range"
        value={value}
      />
    </div>
  );
}

export function ReaderSettingsForm({
  disabled = false,
  idPrefix,
  onChange,
  value,
}: ReaderSettingsFormProps) {
  const { t } = useI18n();
  return (
    <fieldset className="space-y-5" disabled={disabled}>
      <legend className="sr-only">{t('readerSettings.typography')}</legend>
      <label
        className="block text-sm font-medium"
        htmlFor={`${idPrefix}-theme`}
      >
        {t('readerSettings.theme')}
        <select
          className="bg-background mt-2 block h-9 w-full rounded-md border px-3 text-sm"
          id={`${idPrefix}-theme`}
          onChange={(event) => {
            const theme = event.currentTarget.value;
            if (theme === 'light' || theme === 'sepia' || theme === 'dark') {
              onChange({ ...value, theme });
            }
          }}
          value={value.theme}
        >
          <option value="light">{t('readerSettings.themeLight')}</option>
          <option value="sepia">{t('readerSettings.themeSepia')}</option>
          <option value="dark">{t('readerSettings.themeDark')}</option>
        </select>
      </label>
      <label
        className="block text-sm font-medium"
        htmlFor={`${idPrefix}-font-family`}
      >
        {t('readerSettings.font')}
        <select
          className="bg-background mt-2 block h-9 w-full rounded-md border px-3 text-sm"
          id={`${idPrefix}-font-family`}
          onChange={(event) => {
            const fontFamily = event.currentTarget.value;
            if (
              fontFamily === 'publisher' ||
              fontFamily === 'serif' ||
              fontFamily === 'sans-serif'
            ) {
              onChange({ ...value, fontFamily });
            }
          }}
          value={value.fontFamily}
        >
          <option value="publisher">{t('readerSettings.fontPublisher')}</option>
          <option value="serif">{t('readerSettings.fontSerif')}</option>
          <option value="sans-serif">{t('readerSettings.fontSans')}</option>
        </select>
      </label>
      <RangeField
        disabled={disabled}
        id={`${idPrefix}-font-weight`}
        label={t('readerSettings.fontWeight')}
        max={700}
        min={300}
        onChange={(fontWeight) => {
          onChange({ ...value, fontWeight });
        }}
        step={100}
        suffix=""
        value={value.fontWeight}
      />
      <RangeField
        disabled={disabled}
        id={`${idPrefix}-font-size`}
        label={t('readerSettings.fontSize')}
        max={36}
        min={12}
        onChange={(fontSize) => {
          onChange({ ...value, fontSize });
        }}
        step={1}
        suffix="px"
        value={value.fontSize}
      />
      <RangeField
        disabled={disabled}
        id={`${idPrefix}-line-height`}
        label={t('readerSettings.lineHeight')}
        max={2.4}
        min={1.2}
        onChange={(lineHeight) => {
          onChange({ ...value, lineHeight });
        }}
        step={0.1}
        suffix=""
        value={value.lineHeight}
      />
      <RangeField
        disabled={disabled}
        id={`${idPrefix}-content-width`}
        label={t('readerSettings.contentWidth')}
        max={1200}
        min={420}
        onChange={(contentWidth) => {
          onChange({ ...value, contentWidth });
        }}
        step={20}
        suffix="px"
        value={value.contentWidth}
      />
      <RangeField
        disabled={disabled}
        id={`${idPrefix}-margin`}
        label={t('readerSettings.margin')}
        max={96}
        min={0}
        onChange={(margin) => {
          onChange({ ...value, margin });
        }}
        step={4}
        suffix="px"
        value={value.margin}
      />
    </fieldset>
  );
}
