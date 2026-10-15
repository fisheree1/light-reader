import { useI18n } from '../../i18n/use-i18n';

export function RouteLoadingFallback() {
  const { t } = useI18n();
  return (
    <p
      aria-live="polite"
      className="text-muted-foreground grid min-h-screen place-items-center text-sm"
      role="status"
    >
      {t('app.loadingPage')}
    </p>
  );
}
