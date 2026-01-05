const fs = require('fs')
const path = require('path')

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

const SRC_DIR = path.join(__dirname, 'src')
const srcDirs = listDirs(SRC_DIR)
const coreDirs = listDirs(path.join(SRC_DIR, 'core'))
const domainsDirs = listDirs(path.join(SRC_DIR, 'domains'))

const scopeOptions = [
  { value: 'root', name: 'root:       Root-level configuration' },
  { value: 'deps', name: 'deps:       Dependencies' },
  { value: 'ci', name: 'ci:         CI/CD configuration' },
  { value: 'docs', name: 'docs:       Documentation' },
  { value: 'release', name: 'release:    Release/versioning' },

  ...srcDirs
    .filter((dir) => !['core', 'domains'].includes(dir))
    .map((dir) => ({
      value: dir,
      name: `${dir}:${' '.repeat(Math.max(0, 12 - dir.length))} ${dir}`,
    })),

  ...coreDirs.map((dir) => ({
    value: `core/${dir}`,
    name: `core/${dir}:${' '.repeat(Math.max(0, 8 - dir.length))} core ${dir}`,
  })),

  ...domainsDirs.map((dir) => ({
    value: `domains/${dir}`,
    name: `domains/${dir}:${' '.repeat(Math.max(0, 5 - dir.length))} ${dir} domain`,
  })),
]

/** @type {import('cz-git').UserConfig} */
module.exports = {
  prompt: {
    scopes: scopeOptions,
    messages: {
      type: "Select the type of change you're committing:",
      scope: 'Select the scope of this change:',
      subject: 'Write a short, imperative tense description of the change:\n',
      body: 'Provide a longer description of the change (optional). Use "|" to break new line:\n',
      breaking: 'List any BREAKING CHANGES (optional):\n',
      confirmCommit: 'Are you sure you want to proceed with the commit above?',
    },
    types: [
      { value: 'feat', name: 'feat:     A new feature' },
      { value: 'fix', name: 'fix:      A bug fix' },
      { value: 'docs', name: 'docs:     Documentation only changes' },
      { value: 'style', name: 'style:    Changes that do not affect the meaning of the code' },
      {
        value: 'refactor',
        name: 'refactor: A code change that neither fixes a bug nor adds a feature',
      },
      { value: 'perf', name: 'perf:     A code change that improves performance' },
      { value: 'test', name: 'test:     Adding missing tests or correcting existing tests' },
      {
        value: 'build',
        name: 'build:    Changes that affect the build system or external dependencies',
      },
      { value: 'ci', name: 'ci:       Changes to our CI configuration files and scripts' },
      { value: 'chore', name: "chore:    Other changes that don't modify src or test files" },
      { value: 'revert', name: 'revert:   Reverts a previous commit' },
    ],
    useEmoji: false,
    allowCustomScopes: false,
    allowEmptyScopes: false,
    customScopesAlign: 'bottom',
    skipQuestions: [],
    subjectMaxLength: 100,
    markBreakingChangeMode: true,
    allowBreakingChanges: ['feat', 'fix'],
    breaklineNumber: 100,
    breaklineChar: '|',
    issuePrefixes: [
      { value: 'closes', name: 'closes:   ISSUES has been processed' },
      { value: 'fixes', name: 'fixes:    ISSUES has been fixed' },
      { value: 'refs', name: 'refs:     ISSUES has been referenced' },
      { value: 'related', name: 'related:  ISSUES is related to this commit' },
    ],
    defaultScope: '',
    defaultSubject: '',
    defaultBody: '',
    defaultFooterPrefix: '',
    defaultIssues: '',
  },
}
