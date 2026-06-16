import { db } from '@/lib/db';
import type { PaginatedResult, UpdateEntityInput, BulkDeleteInput, EntityContextWithGlAccount } from '@/lib/types/entity-context';

export async function listEntityContexts(
  companyId: string,
  page: number = 1,
  limit: number = 20,
  sortBy: string = 'createdAt',
  sortDir: 'asc' | 'desc' = 'desc',
  search?: string,
  role?: string,
): Promise<PaginatedResult<EntityContextWithGlAccount>> {
  const skip = (page - 1) * limit;
  const orderBy = { [sortBy]: sortDir };

  const where: { companyId: string; pattern?: { contains: string }; role?: string } = { companyId };

  if (search && search.trim()) {
    where.pattern = {
      contains: search.trim(),
    };
  }

  if (role) {
    where.role = role;
  }

  const [data, total] = await Promise.all([
    db.entityContext.findMany({
      where,
      include: { glAccount: true },
      orderBy,
      skip,
      take: limit,
    }),
    db.entityContext.count({ where }),
  ]);

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function updateEntityContext(
  companyId: string,
  id: string,
  input: UpdateEntityInput,
): Promise<EntityContextWithGlAccount | null> {
  // Verify entity exists and belongs to company
  const existing = await db.entityContext.findFirst({
    where: { id, companyId },
  });

  if (!existing) {
    return null;
  }

  // If glAccountId is provided, verify it exists and is active in the same company
  if (input.glAccountId !== undefined && input.glAccountId !== null) {
    const glAccount = await db.glAccount.findFirst({
      where: { id: input.glAccountId, companyId, isActive: true },
    });
    if (!glAccount) {
      throw new Error('GL_ACCOUNT_NOT_FOUND');
    }
  }

  // Prepare roles JSON if roles array is provided
  const rolesJson = input.roles?.length
    ? JSON.stringify(input.roles.map((r) => r.toUpperCase()))
    : undefined;

  const updated = await db.entityContext.update({
    where: { id },
    data: {
      role: input.role?.toUpperCase(),
      glAccountId: input.glAccountId,
      roles: rolesJson,
    },
    include: { glAccount: true },
  });

  return updated;
}

export async function removeEntityContext(companyId: string, id: string): Promise<boolean> {
  const existing = await db.entityContext.findFirst({
    where: { id, companyId },
  });

  if (!existing) {
    return false;
  }

  await db.entityContext.delete({ where: { id } });
  return true;
}

export async function bulkRemoveEntityContexts(companyId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) {
    throw new Error('EMPTY_IDS');
  }

  // Only delete entities belonging to the company
  const result = await db.entityContext.deleteMany({
    where: {
      id: { in: ids },
      companyId,
    },
  });

  return result.count;
}

