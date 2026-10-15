import {
  defaultReadingGoal,
  readingGoalSchema,
  type ReadingGoal,
} from '../../features/reader/domain/reading-activity';
import { AppError } from '../../lib/app-error';
import { getDatabase, type SqlDatabase } from '../client';
import type { ReadingGoalRepository } from './reading-goal-repository';

type DatabaseProvider = () => Promise<SqlDatabase>;

const goalKey = 'reading_goal_v1';

/** Stores the daily reading goal in `app_meta`; no migration is needed. */
export class SqliteReadingGoalRepository implements ReadingGoalRepository {
  private readonly databaseProvider: DatabaseProvider;

  constructor(databaseProvider: DatabaseProvider = getDatabase) {
    this.databaseProvider = databaseProvider;
  }

  async get(): Promise<ReadingGoal> {
    try {
      const database = await this.databaseProvider();
      const rows = await database.select<{ value: string }[]>(
        'SELECT value FROM app_meta WHERE key = $1 LIMIT 1',
        [goalKey],
      );
      if (!rows[0]) return defaultReadingGoal;
      return readingGoalSchema.parse(JSON.parse(rows[0].value));
    } catch (error) {
      throw new AppError('READING_ACTIVITY_FAILED', { cause: error });
    }
  }

  async save(value: ReadingGoal): Promise<ReadingGoal> {
    const goal = readingGoalSchema.parse(value);
    try {
      const database = await this.databaseProvider();
      await database.execute(
        `INSERT INTO app_meta (key, value) VALUES ($1, $2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [goalKey, JSON.stringify(goal)],
      );
      return goal;
    } catch (error) {
      throw new AppError('READING_ACTIVITY_FAILED', { cause: error });
    }
  }
}
