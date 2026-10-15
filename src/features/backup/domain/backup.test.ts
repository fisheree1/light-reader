/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { CURRENT_DATABASE_SCHEMA_VERSION } from './backup';

describe('CURRENT_DATABASE_SCHEMA_VERSION', () => {
  it('matches the native schema version and the newest migration', () => {
    // Backups are rejected when the frontend and the database disagree, so a
    // new migration must update all three together.
    const native = /pub const CURRENT_SCHEMA_VERSION: i64 = (\d+);/.exec(
      readFileSync(resolve('src-tauri', 'src', 'backup.rs'), 'utf8'),
    )?.[1];
    const migrations = readdirSync(resolve('src-tauri', 'migrations'))
      .map((name) => /^(\d{4})_.+\.sql$/.exec(name)?.[1])
      .filter((value): value is string => value !== undefined)
      .map(Number);

    expect(Number(native)).toBe(CURRENT_DATABASE_SCHEMA_VERSION);
    expect(Math.max(...migrations)).toBe(CURRENT_DATABASE_SCHEMA_VERSION);
  });
});
