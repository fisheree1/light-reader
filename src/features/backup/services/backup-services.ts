import { isTauri } from '@tauri-apps/api/core';

import {
  TauriBackupPlatform,
  UnavailableBackupPlatform,
} from '../../../platform/backup/backup-platform';
import { WebCryptoContentHasher } from '../../../platform/crypto/content-hasher';
import { BackupService } from './backup-service';

export const backupManager = new BackupService(
  isTauri() ? new TauriBackupPlatform() : new UnavailableBackupPlatform(),
  new WebCryptoContentHasher(),
);
