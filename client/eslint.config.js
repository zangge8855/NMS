import js from '@eslint/js';
import globals from 'globals';
import babelParser from '@babel/eslint-parser';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';

const vitestGlobals = {
    afterAll: 'readonly',
    afterEach: 'readonly',
    beforeAll: 'readonly',
    beforeEach: 'readonly',
    describe: 'readonly',
    expect: 'readonly',
    it: 'readonly',
    test: 'readonly',
    vi: 'readonly',
};

const plugins = {
    react: reactPlugin,
    'react-hooks': reactHooksPlugin,
    'jsx-a11y': jsxA11yPlugin,
};

const settings = {
    react: {
        version: 'detect',
    },
};

const sharedRules = {
    ...js.configs.recommended.rules,
    ...reactPlugin.configs.recommended.rules,
    'no-console': 'off',
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    'react-hooks/rules-of-hooks': 'error',
    // Surfaced as warnings; the lint script caps the warning count so the
    // existing backlog cannot grow (see "lint" in package.json).
    'react-hooks/exhaustive-deps': 'warn',
    'no-empty': 'off',
    'react/no-unescaped-entities': 'off',
    'jsx-a11y/alt-text': 'error',
    'jsx-a11y/aria-props': 'error',
    'jsx-a11y/aria-proptypes': 'error',
    'jsx-a11y/aria-role': 'error',
    'jsx-a11y/aria-unsupported-elements': 'error',
    'jsx-a11y/role-has-required-aria-props': 'error',
    'jsx-a11y/no-autofocus': 'off',
    'jsx-a11y/click-events-have-key-events': 'off',
    'jsx-a11y/no-static-element-interactions': 'off',
    'jsx-a11y/label-has-associated-control': 'off',
};

export default [
    {
        ignores: [
            'dist/**',
            'coverage/**',
            'node_modules/**',
        ],
    },
    {
        files: ['**/*.{js,jsx}'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
        settings,
        plugins,
        rules: {
            ...sharedRules,
            'no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_|^React$',
            }],
        },
    },
    {
        // TypeScript 7 (native compiler) has no JS API, so typescript-eslint cannot
        // run here. Babel parses TS/TSX syntax for the AST-based rules (hooks,
        // a11y, React); type checking stays with `tsc --noEmit` in the lint script.
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            parser: babelParser,
            parserOptions: {
                requireConfigFile: false,
                babelOptions: {
                    babelrc: false,
                    configFile: false,
                    parserOpts: {
                        plugins: ['jsx', 'typescript'],
                    },
                },
            },
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
        settings,
        plugins,
        rules: {
            ...sharedRules,
            // Scope analysis does not understand type-only names; tsc covers these.
            'no-undef': 'off',
            'no-unused-vars': 'off',
            'no-redeclare': 'off',
            'no-dupe-class-members': 'off',
        },
    },
    {
        files: ['src/**/*.test.{js,jsx,ts,tsx}', 'src/test/**/*.{js,jsx,ts,tsx}'],
        languageOptions: {
            globals: vitestGlobals,
        },
    },
];
