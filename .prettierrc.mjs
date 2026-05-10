/** @type {import("prettier").Config} */
export default {
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  semi: true,
  tabWidth: 2,
  arrowParens: 'always',
  endOfLine: 'lf',
  plugins: ['@ianvs/prettier-plugin-sort-imports'],
  importOrder: [
    '<TYPES>^(node:)',
    '<TYPES>',
    '<TYPES>^[.]',
    '<BUILTIN_MODULES>',
    '<THIRD_PARTY_MODULES>',
    '',
    '^@/(.*)$',
    '',
    '^[./]',
  ],
  importOrderParserPlugins: ['typescript', 'jsx', 'decorators-legacy'],
  importOrderTypeScriptVersion: '5.9.3',
};
