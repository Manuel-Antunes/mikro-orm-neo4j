# nestjs-query-mikro-orm

A [NestJS Query](https://github.com/tripss/nestjs-query) adapter for [MikroORM](https://mikro-orm.io/).

This library provides a seamless integration between NestJS Query and MikroORM, allowing you to build powerful GraphQL APIs with minimal boilerplate.

## Features

- 🚀 Full NestJS Query support with MikroORM
- 📦 Type-safe query building
- 🔍 Advanced filtering and sorting
- 🔗 Relation query support
- 📊 Aggregation queries
- 🎯 Soft delete support
- ✨ Built with TypeScript
- 📦 Dual-format support (ESM & CommonJS)

## Compatibility

This package supports both **ES Modules (ESM)** and **CommonJS (CJS)** for maximum compatibility across different Node.js environments and bundlers.

- **ESM**: `import { MikroOrmQueryService } from 'nestjs-query-mikro-orm'`
- **CommonJS**: `const { MikroOrmQueryService } = require('nestjs-query-mikro-orm')`

The package automatically detects the import method and serves the appropriate format.

## Installation

```bash
pnpm add nestjs-query-mikro-orm

# Install peer dependencies if you haven't already
pnpm add @mikro-orm/core @nestjs/common @nestjs/core @nestjs-query/core reflect-metadata rxjs
```

## Quick Start

### 1. Setup MikroORM Module

```typescript
import { NestQueryMikroOrmModule } from 'nestjs-query-mikro-orm';
import { Module } from '@nestjs/common';
import { UserEntity } from './user.entity';

@Module({
  imports: [NestQueryMikroOrmModule.forFeature([UserEntity])],
})
export class UserModule {}
```

### 2. Create Your Entity

```typescript
import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity()
export class UserEntity {
  @PrimaryKey()
  id!: number;

  @Property()
  name!: string;

  @Property()
  email!: string;

  @Property()
  createdAt: Date = new Date();
}
```

### 3. Use the Query Service

```typescript
import { Injectable } from '@nestjs/common';
import { MikroOrmQueryService } from 'nestjs-query-mikro-orm';
import { UserEntity } from './user.entity';

@Injectable()
export class UserService extends MikroOrmQueryService<UserEntity> {
  // Your custom methods here
}
```

## Development

### Prerequisites

- Node.js >= 18
- pnpm >= 9

### Setup

```bash
# Install dependencies
pnpm install

# Setup git hooks
pnpm prepare
```

### Available Scripts

```bash
# Build the library
pnpm build

# Build in watch mode
pnpm dev

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage

# Lint code
pnpm lint

# Fix lint issues
pnpm lint:fix

# Format code
pnpm format

# Check formatting
pnpm format:check

# Type check
pnpm typecheck
```

### Git Hooks

This project uses Husky for git hooks:

- **pre-commit**: Runs lint-staged to format and lint staged files
- **pre-push**: Runs lint, typecheck, and tests before pushing
- **commit-msg**: Validates commit messages using commitlint

### Commit Convention

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```bash
feat: add new feature
fix: fix bug
docs: update documentation
style: format code
refactor: refactor code
test: add tests
chore: update dependencies
```

## License

MIT

## Author

Manuel Antunes

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
