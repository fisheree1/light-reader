import type { Book } from '../../library/domain/book';
import { libraryServices } from '../../library/services/library-services';
import { agentFacade } from '../services/ai-services';
import type { AgentFacade } from '../services/agent-facade';

export interface ResearchServices {
  agent: AgentFacade;
  listBooks(): Promise<Book[]>;
}

export const researchServices: ResearchServices = {
  agent: agentFacade,
  listBooks: () => libraryServices.repository.list(),
};
