'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setLocale } from '@/i18n/actions';

export function LanguageSwitcher() {
  const t = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const next = locale === 'ar' ? 'en' : 'ar';

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => { await setLocale(next); router.refresh(); })}
      aria-label={t('switchLanguage')}
    >
      {next === 'en' ? 'English' : 'العربية'}
    </button>
  );
}
