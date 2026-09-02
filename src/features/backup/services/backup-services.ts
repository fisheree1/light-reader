import { isTauri } from '@tauri-apps/api/core';

import {
  TauriBackupPlatform,
  UnavailableBackupPlatform,
} from '../../../platform/backup/backup-platform';
import { WebCryptoContentHasher } from '../../../platform/crypto/content-hasher';
import { BackupService } from './backup-service';
import { libraryServices } from '../../library/services/library-services';

export const backupManager = new BackupService(
  isTauri() ? new TauriBackupPlatform() : new UnavailableBackupPlatform(),
  new WebCryptoContentHasher(),
  { bookRepository: libraryServices.repository },
);
