export default {
  '*.{ts,tsx}': ['eslint --fix --max-warnings=0 --no-warn-ignored', 'prettier --write'],
  '*.{js,mjs,cjs}': ['eslint --fix --max-warnings=0 --no-warn-ignored', 'prettier --write'],
  '*.{json,md,css,yaml,yml}': ['prettier --write'],
};
