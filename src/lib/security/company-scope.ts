import { PrismaClient } from '@prisma/client';

export function withCompanyScope(db: PrismaClient, companyId: string) {
  return db.$extends({
    name: 'CompanyScope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const skipOperations = [
            'findUnique',
            'findFirst',
            'create',
            'update',
            'delete',
            'upsert',
          ];

          if (args && !(args as any).skipCompanyScope) {
            const anyArgs = args as any;
            // Scope queries on where conditions
            if (
              operation.startsWith('find') ||
              operation.startsWith('count') ||
              operation.startsWith('aggregate') ||
              operation.startsWith('groupBy')
            ) {
              if (!anyArgs.where) anyArgs.where = {};
              // Only inject companyId if it is present or expected in the schema model query
              if (
                typeof anyArgs.where === 'object' &&
                'companyId' in anyArgs.where &&
                anyArgs.where.companyId === undefined
              ) {
                anyArgs.where.companyId = companyId;
              }
            }

            // Scope writes
            if (operation === 'create') {
              if (!anyArgs.data) anyArgs.data = {};
              if (
                typeof anyArgs.data === 'object' &&
                'companyId' in anyArgs.data &&
                anyArgs.data.companyId === undefined
              ) {
                anyArgs.data.companyId = companyId;
              }
            }

            if (operation === 'createMany') {
              if (Array.isArray(anyArgs.data)) {
                for (const item of anyArgs.data) {
                  if (
                    item &&
                    typeof item === 'object' &&
                    'companyId' in item &&
                    item.companyId === undefined
                  ) {
                    item.companyId = companyId;
                  }
                }
              }
            }
          }
          return query(args);
        },
      },
    },
  });
}
