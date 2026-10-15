import { Upload } from 'lucide-react';

import { Button } from '../../../components/ui/button';
import { useI18n } from '../../../i18n/use-i18n';

interface ImportBookButtonProps {
  isImporting: boolean;
  onImport: () => void;
}

export function ImportBookButton({
  isImporting,
  onImport,
}: ImportBookButtonProps) {
  const { t } = useI18n();
  return (
    <Button aria-busy={isImporting} disabled={isImporting} onClick={onImport}>
      <Upload aria-hidden="true" size={16} />
      {isImporting ? t('library.importing') : t('library.importButton')}
    </Button>
  );
}
