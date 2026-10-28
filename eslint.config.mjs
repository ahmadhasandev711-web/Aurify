import tseslint from 'typescript-eslint';

const RAW_SQL = '/^\\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)$/';

export default tseslint.config(
  { ignores: ['node_modules/**', '.next/**', 'src/generated/**', 'prisma/migrations/**', 'next-env.d.ts'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

      // Module boundaries: other modules are reached only through "@/modules/<name>" (its index.ts).
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/modules/*/*', '**/modules/*/*'],
              message: 'Import another module only through its index.ts: "@/modules/<name>".',
            },
            {
              group: ['**/generated/prisma/*', '@/generated/**'],
              message: 'Import the database from "@/server/db". Generated Prisma types are re-exported there.',
            },
          ],
        },
      ],

      // D-19: no raw SQL outside src/server/db — it would bypass tenant scoping.
      'no-restricted-syntax': [
        'error',
        {
          selector: `MemberExpression[property.name=${RAW_SQL}]`,
          message: 'Raw SQL bypasses tenant isolation. Allowed only inside src/server/db.',
        },
      ],
    },
  },
  {
    // Inside a module, relative imports of its own files are fine.
    files: ['src/modules/**/*.ts', 'src/modules/**/*.tsx'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['@/modules/*/*'], message: 'Use "@/modules/<name>" (index.ts) only.' }] }] },
  },
  {
    files: ['src/server/db/**/*.ts', 'src/server/db.ts'],
    rules: { 'no-restricted-syntax': 'off', 'no-restricted-imports': 'off' },
  },
  {
    files: ['**/*.test.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
);
