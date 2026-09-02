import { Upload } from 'lucide-react';

import { Button } from '../../../components/ui/button';

interface ImportBookButtonProps {
  isImporting: boolean;
  onImport: () => void;
}

export function ImportBookButton({
  isImporting,
  onImport,
}: ImportBookButtonProps) {
  return (
    <Button aria-busy={isImporting} disabled={isImporting} onClick={onImport}>
      <Upload aria-hidden="true" size={16} />
      {isImporting ? '正在导入…' : '导入电子书'}
    </Button>
  );
}
