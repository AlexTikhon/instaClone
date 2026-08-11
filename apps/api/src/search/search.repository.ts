import type {
  ExploreCandidate,
  ExploreCursor,
  SearchUserCandidate,
  SearchUserCursor,
} from './search.types';

export const SEARCH_REPOSITORY = Symbol('SEARCH_REPOSITORY');

export interface SearchRepository {
  searchUsers(
    viewerId: string,
    query: string,
    limit: number,
    cursor: SearchUserCursor | null,
  ): Promise<SearchUserCandidate[]>;
  findExploreCandidates(
    viewerId: string,
    limit: number,
    cursor: ExploreCursor | null,
  ): Promise<ExploreCandidate[]>;
}
