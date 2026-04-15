# @mikro-orm/neo4j

[![NPM Version](https://img.shields.io/npm/v/@mikro-orm/neo4j.svg)](https://npmjs.com/package/@mikro-orm/neo4j)
[![License](https://img.shields.io/npm/l/@mikro-orm/neo4j.svg)](https://github.com/mikro-orm/mikro-orm/blob/master/LICENSE)

A native Neo4j driver for [MikroORM](https://mikro-orm.io/).

This package provides seamless integration between MikroORM and Neo4j, enabling graph-native operations, complex Cypher query building, and advanced graph data modeling (such as relationship properties) while keeping the familiar MikroORM API.

## Features

- 🚀 Full MikroORM `EntityManager` and `EntityRepository` support
- 🕸️ **Graph-native relationships**: Support for proper directed relationships in Neo4j (`IN`, `OUT`).
- 💎 **Relationship Properties (Pivot Entities)**: Model complex graph relationships natively.
- 🏗️ **Neo4jQueryBuilder**: Fluent API wrapping `@neo4j/cypher-builder` to write raw Cypher natively with ORM parameter injection, pattern matching, and relationship navigation (`.related()`).
- 🏷️ **Polymorphic Queries**: Support for multi-label inheritance and querying.
- 🧩 **Native Decorator Extensions**: Fully type-safe strongly-defined `neo4j` and `relation` configuration parameters integrated cleanly inside MikroORM properties via declaration merging.
- 📦 Dual-format support (ESM & CommonJS).

## Installation

```bash
pnpm add @mikro-orm/neo4j neo4j-driver
pnpm add -D @mikro-orm/core @mikro-orm/reflection
```

## Quick Start

### 1. Initialize the ORM

Create your MikroORM instance using the Neo4j driver:

```typescript
import { MikroORM } from '@mikro-orm/neo4j';
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';

const orm = await MikroORM.init({
  clientUrl: 'bolt://localhost:7687', // Your Neo4j URI
  user: 'neo4j',
  password: 'password',
  entities: ['./dist/entities'],
  entitiesTs: ['./src/entities'],
  metadataProvider: TsMorphMetadataProvider,
});

const em = orm.em;
```

### 2. Define Entities natively

You can build entities normally by tapping into the native extension properties **`relation`** inside `@ManyToOne`/`@ManyToMany` decorators, and **`neo4j`** inside `@Entity()` decorators. 

#### Setting up TypeScript Typings

Because `mikro-orm-neo4j` uses global declaration merging to augment `@mikro-orm/core`, you get autocomplete natively without requiring any `as any` casts! To ensure your TypeScript compiler (`tsc`) correctly registers these definitions in your project, simply add `@mikro-orm/neo4j/types` to your `tsconfig.json` compiler options, or add a triple-slash reference in your `global.d.ts`:

```json
// tsconfig.json
{
  "compilerOptions": {
    "types": [
      "node",
      "@mikro-orm/neo4j/types"
    ]
  }
}
```

Or programmatically in any entry file:
```typescript
/// <reference types="@mikro-orm/neo4j/types" />
```

Once the types are recognized by your IDE, you can construct perfectly valid MikroORM entities like this:

```typescript
import { Entity, PrimaryKey, Property, ManyToOne, Collection, OneToMany } from '@mikro-orm/core';

@Entity({ neo4j: { labels: ['User', 'Person'] } })
export class User {
  @PrimaryKey()
  id!: string;

  @Property()
  name!: string;

  @OneToMany(() => Post, post => post.author)
  posts = new Collection<Post>(this);
}

@Entity()
export class Post {
  @PrimaryKey()
  id!: string;

  @Property()
  title!: string;

  // Utilize the natively-augmented relation object to denote Neo4j specifics
  @ManyToOne(() => User, { relation: { type: 'CREATED', direction: 'IN' } })
  author!: User;
}
```

### 3. Relationship Properties (Pivot Entities)

In Neo4j, relationships can have their own properties. You can model this using a standard `@Entity()` configured as a `relationshipEntity`.

```typescript
import { Entity, PrimaryKey, Property, ManyToOne, Collection, ManyToMany } from '@mikro-orm/core';

@Entity()
export class Actor {
  @PrimaryKey()
  id!: string;

  @Property()
  name!: string;
  
  @ManyToMany(() => Movie, undefined, {
    pivotEntity: () => ActedIn,
    inversedBy: 'actors',
    relation: { type: 'ACTED_IN', direction: 'OUT' }
  })
  movies = new Collection<Movie>(this);
}

@Entity()
export class Movie {
  @PrimaryKey()
  id!: string;

  @Property()
  title!: string;
}

// Mark this entity as a Neo4j Relationship instead of a Node!
@Entity({ neo4j: { relationshipEntity: true, type: 'ACTED_IN' } })
export class ActedIn {
  @PrimaryKey()
  id!: string;

  @ManyToOne(() => Actor, { primary: true })
  actor!: Actor;

  @ManyToOne(() => Movie, { primary: true })
  movie!: Movie;

  @Property()
  roles!: string[]; // Relationship property stored inside Neo4j relation data!
}
```

> [!TIP]
> **Why `relation` instead of custom decorators like `@Rel`?**
> Relying on MikroORM's built-in `PropertyOptions` ensures better compatibility with the internal lifecycle hook systems and removes the buggy reflection extraction complexities of scanning custom external decorators during schema generation.

### 4. Constructing Complex Cypher Queries (`Neo4jQueryBuilder`)

The custom `Neo4jQueryBuilder` extends MikroORM principles and seamlessly bridges them to robust graph traversal queries via Cypher. 

Here are some comprehensive examples:

#### Filtering & Relation traversal with `match` and `related`

```typescript
const qb = em.createQueryBuilder(User);

// Finds users named John Doe who created a specific post, and returns the post title
const result = await qb
  .match()
  .where('name', 'John Doe')
  .related(User, 'posts') // automatically extracts 'CREATED' relationship
  .where('title', 'Graph Databases 101')
  .return(['title'])
  .execute();
```

#### Complex Multi-Path Traversals 

You can build chains and complex logic easily.

```typescript
const qb = em.createQueryBuilder(Actor);
const Cypher = qb.getCypher(); // Direct access to underlying @neo4j/cypher-builder toolkit

// Find actors who acted in "The Matrix" AND also directed it
const { cypher, params } = qb
  .match()
  .related(Actor, 'movies')
  .where('title', 'The Matrix')
  .match() // Starts a new MATCH statement linking the context
  // Use raw pattern building for complex or undocumented graph spans
  .rawCypherPattern(new Cypher.Pattern(qb.getCurrentNode()).related(new Cypher.Relationship({ type: 'DIRECTED' })).to(new Cypher.Node({ labels: ['Movie'] })))
  .return(['name'])
  .build();

console.log(cypher); 
// MATCH (this0:actor)-[this2:ACTED_IN]->(this1:movie)
// WHERE this1.title = $param0
// MATCH (this0)-[this3:DIRECTED]->(this4:Movie)
// RETURN this0.name
```

#### Advanced Query Expressions with `Cypher` 

```typescript
const qb = em.createQueryBuilder(Product);
const Cypher = qb.getCypher();

// Complex WHERE clauses with boolean logic
const { cypher } = qb
  .match()
  .where(
    Cypher.or(
      Cypher.eq(qb.getCurrentNode().property('name'), new Cypher.Param('Laptop')),
      Cypher.gt(qb.getCurrentNode().property('price'), new Cypher.Param(1000))
    )
  )
  .return()
  .build();
```

Or you can use raw parameterized queries effortlessly:

```typescript
const users = await em.run(
  `MATCH (u:User)-[:CREATED]->(p:Post) WHERE p.title = $title RETURN u`,
  { title: 'Graph Databases 101' }
);
```

## License

MIT License

## Author

Manuel Antunes
