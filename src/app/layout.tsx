import type { ReactNode } from 'react';

export const metadata = { title: 'Aurify' };

// D-09: Arabic RTL by default. Real i18n (next-intl) arrives with the first screens.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
