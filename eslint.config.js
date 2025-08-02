import { defineConfig } from 'eslint/config';
import globals from 'globals';

const commonRules = {
    'no-unused-vars': 'warn',
    'indent': ['error', 4, { 'SwitchCase': 1 }],
    'quotes': ['error', 'single'],
    'semi': ['error', 'always'],
    'no-trailing-spaces': 'error',
    'eol-last': 'error'
};

export default defineConfig([{
    files: ['**/*.{js,mjs,cjs}'],
    ignores: ['public/**'],
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        globals: {
            ...globals.node,
        }
    },
    rules: {
        ...commonRules
    }
},
{
    files: ['public/**/*.js'],
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        globals: {
            ...globals.browser,
        }
    },
    rules: {
        ...commonRules
    }
}]);
