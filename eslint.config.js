const globals = require('globals')
const js = require('@eslint/js')
const { FlatCompat } = require('@eslint/eslintrc')

const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
})

module.exports = [{
    ignores: ['**/dist'],
}, ...compat.extends('eslint:recommended'), {
    languageOptions: {
        globals: {
            ...globals.node,
        },
        ecmaVersion: 2023,
        sourceType: 'commonjs',
    },

    rules: {
        indent: ['error', 4, {
            SwitchCase: 1,
        }],
        'linebreak-style': ['error', 'windows'],
        quotes: ['error', 'single'],
        semi: ['error', 'never'],
        'no-var': ['error'],
        'no-console': [0],
        'no-control-regex': [0],
        'no-unused-vars': ['error', {
            vars: 'all',
            args: 'none',
            ignoreRestSiblings: false,
            argsIgnorePattern: 'reject',
            caughtErrors: 'none',
        }],
        'no-async-promise-executor': [0],
    },
}, {
    files: ['app/assets/js/scripts/*.js'],
    rules: {
        'no-unused-vars': [0],
        'no-undef': [0],
    },
}]