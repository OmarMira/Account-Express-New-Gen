'use client';

import { NextIntlClientProvider } from 'next-intl';
import { useLanguageStore } from '@/store/language-store';
import { translations } from '@/lib/i18n';
import { useEffect } from 'react';

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const { language } = useLanguageStore();

  useEffect(() => {
    document.cookie = `locale=${language}; path=/; max-age=31536000; SameSite=Lax`;
  }, [language]);

  return (
    <NextIntlClientProvider locale={language} messages={translations[language]}>
      {children}
    </NextIntlClientProvider>
  );
}
