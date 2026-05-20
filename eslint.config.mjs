import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// eslint-config-next 15.5 ships the legacy (eslintrc) format only, so we bridge
// it into ESLint 9 flat config via FlatCompat. core-web-vitals + typescript are
// the two configs create-next-app wires by default.
const compat = new FlatCompat({ baseDirectory: __dirname })

const eslintConfig = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'hetzner-worker/**',
      'supabase/**',
      'public/**',
      'next-env.d.ts',
      '*.config.*',
      'tsconfig.tsbuildinfo',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // Pure JSX-text cosmetics (straight quotes/apostrophes in marketing and
      // legal copy). High noise, zero correctness value — off by deliberate
      // choice, not oversight.
      'react/no-unescaped-entities': 'off',
      // Honor the `_`-prefix convention for deliberately-unused bindings
      // (caught errors, positional args, placeholder destructures).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
]

export default eslintConfig
