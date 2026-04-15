# Contributing to @mikro-orm/neo4j

Thank you for considering contributing to the `mikro-orm-neo4j` driver! We appreciate your help in making this project better.

## Getting Started

1. **Fork the repository** on GitHub.
2. **Clone your fork**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/mikro-orm-neo4j.git
   cd mikro-orm-neo4j
   ```
3. **Create a new branch** for your feature or fix:
   ```bash
   git checkout -b feature/amazing-feature
   ```
4. **Install dependencies**. We use `pnpm` as our package manager:
   ```bash
   pnpm install
   ```

## Development Workflow

### Making Changes

- The driver's source code is located in the `src/` directory.
- Test files are located in the `tests/` directory.
- This codebase is strongly typed. Ensure your changes compile strictly without type errors.

### Testing

This project has a comprehensive test suite using `vitest` covering unit tests, query builder tests, and full DB execution contexts using testcontainers.

In order to run the integration tests properly, ensure you have **Docker running** on your machine (to spin up `testcontainers` for Neo4j instance simulation).

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# View detailed test outputs
pnpm test --reporter=verbose
```

### Code Quality and Tooling

Before pushing your code, please run the following commands to ensure everything is aligned with the project's standards:

```bash
# Check TypeScript types
pnpm typecheck

# Lint your code
pnpm lint

# Fix linting issues automatically
pnpm lint:fix

# Format your code using Prettier
pnpm format

# Build the project to ensure both ESM and CJS bundles succeed
pnpm build
```

## Commit Guidelines

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Please format your commit messages appropriately:

```
<type>(<scope>): <subject>
```

**Types:**
- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Code style/formatting changes
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools

**Example:**
```
feat(query-builder): implement support for EXISTS subqueries
fix(driver): correct parameter mapping for relationship properties
```

## Pull Request Process

1. Ensure your branch is rebased against the `main` branch.
2. Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` locally. Address any failures before pushing.
3. Push your feature branch to your GitHub fork.
4. Open a Pull Request toward the main repository.
5. Provide a clear description of the problem solved or feature added. Link to any relevant open issues.
6. A maintainer will review your Pull Request. Address any requested changes or feedback.

## Questions?

If you encounter any issues or have questions regarding architecture or feature proposals:
- Open an issue for discussion.
- Reach out with your ideas before writing massive amounts of code.

Thank you for contributing! 🎉
