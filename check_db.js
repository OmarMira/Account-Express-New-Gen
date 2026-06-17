import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const allTxs = await prisma.bankTransaction.findMany({
      where: {
          description: { contains: 'Omar' }
      }
  });
  console.log("Omar Txs:", allTxs.length, "total amount:", allTxs.reduce((sum, t) => sum + t.amount, 0));
  
  const lyftTxs = await prisma.bankTransaction.findMany({
      where: {
          description: { contains: 'Lyft' }
      }
  });
  console.log("Lyft Txs:", lyftTxs.length, "total amount:", lyftTxs.reduce((sum, t) => sum + t.amount, 0));
}

main().catch(console.error).finally(() => prisma.$disconnect());
