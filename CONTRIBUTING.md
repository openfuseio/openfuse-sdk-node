# Contributing to Openfuse SDK

Thanks for your interest in contributing!

## Development Setup

```bash
# Clone the repo
git clone https://github.com/openfuseio/openfuse-sdk-node.git
cd openfuse-sdk-node

# Install dependencies
pnpm install

# Run tests
pnpm test:unit

# Build
pnpm build
```

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add or update tests as needed
4. Run `pnpm lint` and `pnpm test:unit`
5. Commit using conventional commits (run `pnpm git:commit` for interactive prompt)
6. Open a pull request

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: resolve bug
docs: update documentation
test: add tests
refactor: code changes without feature/fix
chore: maintenance tasks
```

## Code Style

- Code is formatted with Prettier and linted with ESLint
- Pre-commit hooks run automatically via husky
- Run `pnpm format` to format all files

## Tests

```bash
pnpm test:unit    # Unit tests
pnpm test:e2e     # E2E tests (requires local API)
pnpm test         # Watch mode
```

## Questions?

Open an issue or start a discussion.
