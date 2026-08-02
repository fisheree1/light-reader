import Database from '@tauri-apps/plugin-sql';

const DATABASE_URL = 'sqlite:light-reader.db';

let databasePromise: Promise<Database> | undefined;

export interface SqlDatabase {
  execute(query: string, bindValues?: unknown[]): Promise<unknown>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
}

export function getDatabase(): Promise<SqlDatabase> {
  databasePromise ??= Database.load(DATABASE_URL).then(async (database) => {
    await database.execute('PRAGMA foreign_keys = ON');
    return database;
  });
  return databasePromise;
}

export async function closeDatabaseForMaintenance(): Promise<void> {
  const activeDatabase = databasePromise;
  databasePromise = undefined;
  const database = activeDatabase
    ? await activeDatabase
    : Database.get(DATABASE_URL);
  await database.close(DATABASE_URL);
}

interface AppMetaRow {
  value: string;
}

export async function checkDatabaseHealth(): Promise<boolean> {
  const database = await getDatabase();
  const value = new Date().toISOString();

  await database.execute(
    `INSERT INTO app_meta (key, value)
     VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ['health_check', value],
  );

  const rows = await database.select<AppMetaRow[]>(
    'SELECT value FROM app_meta WHERE key = $1 LIMIT 1',
    ['health_check'],
  );

  return rows[0]?.value === value;
}
