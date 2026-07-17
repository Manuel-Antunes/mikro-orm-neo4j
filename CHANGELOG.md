# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `Neo4jSchemaGenerator.ensureIndexes()` now materializes `@Index()` / `@Unique()` declarations as
  Neo4j indexes and constraints (RANGE, TEXT, POINT, FULLTEXT and unique constraints, on both nodes
  and relationship entities). Previously a no-op, so declarations were silently inert.
- `getCreateSchemaSQL()` returns those statements as a dry-run script, and `create()` delegates to
  `ensureIndexes()`.
- Options with no Neo4j equivalent now fail loudly instead of silently changing meaning: `where`
  (partial indexes) and `type: 'vector'` throw; `expression` warns and is skipped.
- Initial release
- MikroORM query service implementation
- Filter query builder
- Relation query builder
- Aggregate query builder
- SQL comparison builder
- Support for soft delete entities

### Changed

- Upgraded MikroORM to 7.1.6.

## [0.0.1] - 2026-02-06

### Added

- Project initialization
- Core query functionality
- Basic test suite
- Documentation
