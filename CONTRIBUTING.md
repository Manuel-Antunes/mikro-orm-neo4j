# Contributing to nestjs-query-mikro-orm

Thank you for your interest in contributing to nestjs-query-mikro-orm! This document provides guidelines and instructions for contributing.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/nestjs-query-mikro-orm.git`
3. Create a new branch: `git checkout -b feature/your-feature-name`
4. Install dependencies: `pnpm install`
5. Setup git hooks: `pnpm prepare`

## Development Workflow

### Making Changes

1. Make your changes in the `src/` directory
2. Add or update tests in `__tests__/` as needed
3. Run tests to ensure everything works: `pnpm test`
4. Run linting and formatting: `pnpm lint` and `pnpm format`
5. Build the project: `pnpm build`

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage
```

### Code Quality

Before committing, make sure your code passes all checks:

```bash
# Lint your code
pnpm lint

# Fix linting issues automatically
pnpm lint:fix

# Check TypeScript types
pnpm typecheck

# Format your code
pnpm format
```

## Commit Guidelines

This project follows [Conventional Commits](https://www.conventionalcommits.org/). Your commit messages should be structured as follows:

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that don't affect code meaning (white-space, formatting, etc)
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `perf`: Code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools

### Examples

```
feat(query): add support for complex aggregations

fix(filter): handle null values in date filters correctly

docs: update README with new examples

test(services): add tests for relation query service
```

## Pull Request Process

1. Update the README.md with details of changes if applicable
2. Update tests to cover your changes
3. Ensure all tests pass and code quality checks succeed
4. Update the CHANGELOG.md if it's a significant change
5. The PR will be merged once you have the sign-off of at least one maintainer

## Code Style

- Use TypeScript for all code
- Follow the existing code style (enforced by ESLint and Prettier)
- Write clear, self-documenting code
- Add JSDoc comments for public APIs
- Keep functions small and focused
- Write meaningful variable and function names

## Testing Guidelines

- Write tests for all new features
- Ensure existing tests still pass
- Aim for high code coverage
- Use descriptive test names
- Follow the AAA pattern (Arrange, Act, Assert)

## Questions?

If you have questions, feel free to:

- Open an issue for discussion
- Reach out to the maintainers

Thank you for contributing! 🎉
