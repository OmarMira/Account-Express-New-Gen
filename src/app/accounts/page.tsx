import { db } from '@/lib/db';
import { AccountsClient } from '@/components/spa/AccountsClient';
import { AppShell } from '@/components/spa/AppShell';
import { cookies } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';

export default async function AccountsServerPage() {
  const cookieStore = await cookies();
  const companyId = cookieStore.get('companyId')?.value;
  const locale = cookieStore.get('locale')?.value || 'es';
  const messages = await getMessages();

  let initialAccounts: any[] = [];
  if (companyId) {
    initialAccounts = await db.glAccount.findMany({
      where: { companyId },
      include: {
        _count: {
          select: { children: true, journalLines: true },
        },
      },
      orderBy: { code: 'asc' },
    });
  }

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <AppShell>
        <AccountsClient initialAccounts={initialAccounts} />
      </AppShell>
    </NextIntlClientProvider>
  );
}
