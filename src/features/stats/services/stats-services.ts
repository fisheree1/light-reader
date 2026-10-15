import { isTauri } from '@tauri-apps/api/core';

import type { ReadingActivityRepository } from '../../../database/repositories/reading-activity-repository';
import type { ReadingGoalRepository } from '../../../database/repositories/reading-goal-repository';
import { SqliteReadingActivityRepository } from '../../../database/repositories/sqlite-reading-activity-repository';
import { SqliteReadingGoalRepository } from '../../../database/repositories/sqlite-reading-goal-repository';
import { WebReadingActivityRepository } from '../../../database/repositories/web-reading-activity-repository';
import { WebReadingGoalRepository } from '../../../database/repositories/web-reading-goal-repository';
import { libraryServices } from '../../library/services/library-services';

export interface StatsServices {
  activityRepository: ReadingActivityRepository;
  goalRepository: ReadingGoalRepository;
}

export const statsServices: StatsServices = isTauri()
  ? {
      activityRepository: new SqliteReadingActivityRepository(),
      goalRepository: new SqliteReadingGoalRepository(),
    }
  : {
      activityRepository: new WebReadingActivityRepository(
        libraryServices.repository,
      ),
      goalRepository: new WebReadingGoalRepository(),
    };
