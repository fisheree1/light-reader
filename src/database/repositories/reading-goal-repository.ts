import type { ReadingGoal } from '../../features/reader/domain/reading-activity';

export interface ReadingGoalRepository {
  get(): Promise<ReadingGoal>;
  save(goal: ReadingGoal): Promise<ReadingGoal>;
}
