import {
  defaultReadingGoal,
  readingGoalSchema,
  type ReadingGoal,
} from '../../features/reader/domain/reading-activity';
import { getWebDatabase, type WebDatabase } from '../web/web-database';
import { webSettingKeys } from '../web/web-records';
import { withAppError } from '../web/web-repository-support';
import type { ReadingGoalRepository } from './reading-goal-repository';

export class WebReadingGoalRepository implements ReadingGoalRepository {
  private readonly database: WebDatabase;

  constructor(database: WebDatabase = getWebDatabase()) {
    this.database = database;
  }

  get(): Promise<ReadingGoal> {
    return withAppError('READING_ACTIVITY_FAILED', async () => {
      const stored = await this.database.get(
        'settings',
        webSettingKeys.readingGoal,
      );
      return stored === undefined
        ? defaultReadingGoal
        : readingGoalSchema.parse(stored);
    });
  }

  async save(value: ReadingGoal): Promise<ReadingGoal> {
    const goal = readingGoalSchema.parse(value);
    return withAppError('READING_ACTIVITY_FAILED', async () => {
      await this.database.write([
        {
          type: 'put',
          store: 'settings',
          key: webSettingKeys.readingGoal,
          value: goal,
        },
      ]);
      return goal;
    });
  }
}
