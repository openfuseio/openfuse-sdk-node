// cz.config.cjs
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

// First level under src/*
const firstLevel = listDirs(SRC_DIR).map((n) => ({ name: n }))

// Second level under src/domains/* -> "domains/<name>"
const domains = listDirs(path.join(SRC_DIR, 'domains')).map((n) => ({ name: `domains/${n}` }))

// Meta scopes (non-src)
const meta = ['deps', 'ci', 'docs', 'infra', 'release', 'root'].map((n) => ({ name: n }))

module.exports = {
  types: [
    { value: 'feat', name: 'feat:      A new feature' },
    { value: 'fix', name: 'fix:       A bug fix' },
    { value: 'perf', name: 'perf:      Performance improvement' },
    { value: 'refactor', name: 'refactor:  No behavior change' },
    { value: 'docs', name: 'docs:      Documentation only' },
    { value: 'style', name: 'style:     Formatting only' },
    { value: 'test', name: 'test:      Add/correct tests' },
    { value: 'build', name: 'build:     Build system/deps' },
    { value: 'ci', name: 'ci:        CI config/scripts' },
    { value: 'chore', name: 'chore:     Maintenance' },
    { value: 'revert', name: 'revert:    Revert a commit' },
  ],
  scopes: [...firstLevel, ...domains, ...meta],
  messages: {
    type: 'Select the type of change:',
    scope: 'Select the scope(s) (required):',
    subject: 'Short, imperative description:\n',
    body: 'Longer description (optional). Use | for new line:\n',
    breaking: 'List BREAKING CHANGES (optional):\n',
    footer: 'Issues/Refs, e.g. Closes #123 (optional):\n',
    confirmCommit: 'Ready to commit?',
  },
  allowCustomScopes: false,
  allowEmptyScopes: false,
  enableMultipleScopes: true, // allows "api,domains/companies"
  subjectLimit: 72,
  useEmoji: false,
}
