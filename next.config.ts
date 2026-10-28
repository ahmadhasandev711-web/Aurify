import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  // The worker runs as a separate Node process from the same code (D-12); the web build
  // only needs a self-contained output for the container image.
  output: 'standalone',
  poweredByHeader: false,
};

export default withNextIntl(config);
