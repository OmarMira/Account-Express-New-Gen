import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { translations, type Locale } from '@/lib/i18n';
import { getTranslation } from '@/lib/i18n';

interface LanguageState {
  language: Locale;
  setLanguage: (lang: Locale) => void;
  t: (key: string) => string;
  _hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;
}

const createTranslator =
  (lang: Locale) =>
  (key: string): string => {
    const localeTranslations = translations[lang] as Record<string, unknown>;
    return getTranslation(localeTranslations, key, key);
  };

export const useLanguageStore = create<LanguageState>()(
  persist(
    (set, get) => ({
      language: 'es' as Locale,
      _hasHydrated: false,

      setLanguage: (lang: Locale) =>
        set({
          language: lang,
          t: createTranslator(lang),
        }),

      setHasHydrated: (state: boolean) =>
        set({
          _hasHydrated: state,
        }),

      t: createTranslator('es' as Locale),
    }),
    {
      name: 'accountexpress-language',
      partialize: (state) => ({ language: state.language }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.t = createTranslator(state.language);
          state.setHasHydrated(true);
        }
      },
    },
  ),
);
