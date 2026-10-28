import { getTranslations } from 'next-intl/server';
import { LanguageSwitcher } from '@/components/language-switcher';

export default async function HomePage() {
  const t = await getTranslations();
  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif' }}>
      <h1>{t('common.appName')}</h1>
      <p>{t('home.tagline')}</p>
      <LanguageSwitcher />
    </main>
  );
}
