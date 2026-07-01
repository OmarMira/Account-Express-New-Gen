import { EntityContext } from '@prisma/client';

export type EntityContextWithGlAccount = Omit<
  EntityContext,
  'classificationStatus' | 'classificationConfidence'
> & Partial<Pick<EntityContext, 'classificationStatus' | 'classificationConfidence'>> & {
  glAccount: {
    id: string;
    code: string;
    name: string;
  } | null;
};

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface UpdateEntityInput {
  role?: string | null;
  glAccountId?: string | null;
  roles?: string[];
  transactionDirection?: string | null;
  classificationStatus?: 'UNCLASSIFIED' | 'PENDING_REVIEW' | 'CONFIRMED';
  classificationConfidence?: number | null;
}

export interface BulkDeleteInput {
  ids: string[];
}
