import { db } from './src/lib/db';

async function check() {
  console.log('Keys in db:', Object.keys(db as any));
  if ('session' in (db as any)) {
    console.log('✅ Session model IS present in Prisma Client.');
  } else {
    console.log('❌ Session model IS MISSING in Prisma Client.');
  }
  await db.$disconnect();
}

check();
