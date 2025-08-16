const fs = require('fs')
const path = require('path')

const SRC_DIR = path.join(__dirname, 'src')

function listDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
}

const firstLevel = listDirs(SRC_DIR) // e.g. ['client','core','domains', ...]

const domainSeconds = listDirs(path.join(SRC_DIR, 'domains')).map((n) => `domains/${n}`)

// small meta set for non-src changes (root docker/compose, lockfiles, etc.)
const metaScopes = ['deps', 'ci', 'docs', 'infra', 'release', 'root']

const scopes = Array.from(new Set([...firstLevel, ...domainSeconds, ...metaScopes]))

/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Conventional types
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'perf',
        'refactor',
        'docs',
        'style',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],

    // Scopes (dynamic)
    'scope-empty': [2, 'never'],
    'scope-enum': [2, 'always', scopes],

    // Allow "domains/companies" style scopes (disable strict case check to permit '/')
    'scope-case': [0],

    // Subject/format hygiene
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 72],
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always'],
  },
}
