import Database from '@tauri-apps/plugin-sql';

const DATABASE_URL = 'sqlite:light-reader.db';

let databasePromise: Promise<Database> | undefined;

export function getDatabase(): Promise<Database> {
  databasePromise ??= Database.load(DATABASE_URL);
  return databasePromise;
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
