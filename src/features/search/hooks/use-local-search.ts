import { useCallback, useState } from 'react';

import { asAppError } from '../../../lib/app-error';
import type { LocalSearchResults } from '../domain/search';
import type {
  LocalSearchService,
  SearchIndexRebuildResult,
} from '../services/local-search-service';

type SearchPhase = 'error' | 'idle' | 'loading' | 'ready';

export function useLocalSearch(service: LocalSearchService) {
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState<SearchPhase>('idle');
  const [results, setResults] = useState<LocalSearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [rebuildResult, setRebuildResult] =
    useState<SearchIndexRebuildResult | null>(null);

  const search = useCallback(async () => {
    setError(null);
    setRebuildResult(null);
    if (!query.trim()) {
      setResults(null);
      setPhase('idle');
      return;
    }
    setPhase('loading');
    try {
      setResults(await service.search(query));
      setPhase('ready');
    } catch (reason) {
      setError(asAppError(reason, 'SEARCH_FAILED').userMessage);
      setPhase('error');
    }
  }, [query, service]);

  const rebuild = useCallback(async () => {
    setIsRebuilding(true);
    setError(null);
    setRebuildResult(null);
    try {
      const rebuilt = await service.rebuildIndex();
      setRebuildResult(rebuilt);
      if (query.trim()) {
        setResults(await service.search(query));
        setPhase('ready');
      }
    } catch (reason) {
      setError(asAppError(reason, 'SEARCH_INDEX_FAILED').userMessage);
      setPhase('error');
    } finally {
      setIsRebuilding(false);
    }
  }, [query, service]);

  return {
    error,
    isRebuilding,
    phase,
    query,
    rebuild,
    rebuildResult,
    results,
    search,
    setQuery,
  };
}
