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
            // Scope queries on where conditions
            if (
              operation.startsWith('find') ||
              operation.startsWith('count') ||
              operation.startsWith('aggregate') ||
              operation.startsWith('groupBy')
            ) {
              if (!args.where) args.where = {};
              if (!args.where.companyId) {
                args.where.companyId = companyId;
              }
            }

            // Scope writes
            if (operation === 'create') {
              if (!args.data) args.data = {};
              if (!args.data.companyId) {
                args.data.companyId = companyId;
              }
            }

            if (operation === 'createMany') {
              if (Array.isArray(args.data)) {
                for (const item of args.data) {
                  if (!item.companyId) item.companyId = companyId;
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
