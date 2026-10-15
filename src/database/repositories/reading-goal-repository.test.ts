import type { SqlDatabase } from '../client';
import { createTestWebDatabase } from '../../test/fixtures/web-records';
import { SqliteReadingGoalRepository } from './sqlite-reading-goal-repository';
import { WebReadingGoalRepository } from './web-reading-goal-repository';

class AppMetaDatabase implements SqlDatabase {
  value: string | null = null;

  execute(_query: string, values: unknown[] = []): Promise<unknown> {
    this.value = String(values[1]);
    return Promise.resolve({});
  }

  select<T>(): Promise<T> {
    return Promise.resolve(
      (this.value === null ? [] : [{ value: this.value }]) as T,
    );
  }
}

describe.each([
  [
    'SqliteReadingGoalRepository',
    () => {
      const database = new AppMetaDatabase();
      return {
        repository: new SqliteReadingGoalRepository(() =>
          Promise.resolve(database),
        ),
        corrupt: () => {
          database.value = '{"schemaVersion":1,"dailyMinutes":1}';
          return Promise.resolve();
        },
      };
    },
  ],
  [
    'WebReadingGoalRepository',
    () => {
      const database = createTestWebDatabase();
      return {
        repository: new WebReadingGoalRepository(database),
        corrupt: () =>
          database.write([
            {
              type: 'put',
              store: 'settings',
              key: 'reading-goal',
              value: { dailyMinutes: 'x' },
            },
          ]),
      };
    },
  ],
])('%s', (_name, setup) => {
  it('defaults to no goal and persists a validated goal', async () => {
    const { repository } = setup();
    await expect(repository.get()).resolves.toEqual({
      schemaVersion: 1,
      dailyMinutes: null,
    });

    await repository.save({ schemaVersion: 1, dailyMinutes: 30 });
    await expect(repository.get()).resolves.toEqual({
      schemaVersion: 1,
      dailyMinutes: 30,
    });
    await expect(
      repository.save({ schemaVersion: 1, dailyMinutes: 1 }),
    ).rejects.toThrow();
  });

  it('reports a corrupt stored goal', async () => {
    const { repository, corrupt } = setup();
    await corrupt();

    await expect(repository.get()).rejects.toMatchObject({
      code: 'READING_ACTIVITY_FAILED',
    });
  });
});
