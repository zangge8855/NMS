import js from '@eslint/js';
import globals from 'globals';
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
        settings: {
            react: {
                version: 'detect',
            },
        },
        plugins: {
            react: reactPlugin,
            'react-hooks': reactHooksPlugin,
            'jsx-a11y': jsxA11yPlugin,
        },
        rules: {
            ...js.configs.recommended.rules,
            ...reactPlugin.configs.recommended.rules,
            'no-console': 'off',
            'no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_|^React$',
            }],
            'react/react-in-jsx-scope': 'off',
            'react/prop-types': 'off',
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'off',
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
        },
    },
    {
        files: ['src/**/*.test.{js,jsx}', 'src/test/**/*.{js,jsx}'],
        languageOptions: {
            globals: vitestGlobals,
        },
    },
];
