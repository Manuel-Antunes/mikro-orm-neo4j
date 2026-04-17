# @mikro-orm/neo4j

[![NPM Version](https://img.shields.io/npm/v/@mikro-orm/neo4j.svg)](https://www.npmjs.com/package/mikro-orm-neo4j)
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

### 2. Define Entities

You can define entities using standard MikroORM decorators, but with native Neo4j extensions. 

#### Decorator Approach

Support for native extension properties **`relation`** inside `@ManyToOne`/`@ManyToMany` decorators, and **`neo4j`** inside `@Entity()` decorators allows you to configure graph-specific metadata.

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

#### Functional Approach (`defineEntity`)

For those who prefer a functional style or are building dynamic schemas, `@mikro-orm/neo4j` provides a specialized `defineEntity` wrapper that includes the `neo4j` helper for property configuration.

```typescript
import { defineEntity, neo4j } from '@mikro-orm/neo4j';
import * as crypto from 'node:crypto';

export const MovieSchema = defineEntity({
  name: 'Movie',
  labels: ['Cinema', 'Show'], // Native Neo4j labels
  properties(p) {
    return {
      id: p.uuid().primary().onCreate(() => crypto.randomUUID()),
      title: p.string(),
      released: p.integer(),
      actors: () => neo4j(
        p.manyToMany(ActorSchema).mappedBy('movies'),
        { type: 'ACTED_IN', direction: 'IN' }
      ),
    };
  },
});

// To add logic or methods, use setClass
export class Movie extends (MovieSchema.class as any) {
  get isNew(): boolean {
    return this.released > 2020;
  }
}
MovieSchema.setClass(Movie as any);
```

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

#### Using decorators

Mark this entity as a Neo4j Relationship instead of a Node!

```typescript
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

#### Using `defineEntity`

```typescript
const ActedInSchema = defineEntity({
  name: 'ActedIn',
  relationship: { type: 'ACTED_IN' },
  properties(p) {
    return {
      id: p.uuid().primary(),
      actor: () => p.manyToOne(ActorSchema).primary(),
      movie: () => p.manyToOne(MovieSchema).primary(),
      roles: p.array('string'),
    };
  },
});
```

> [!TIP]
> **Why `relation` instead of custom decorators like `@Rel`?**
> Relying on MikroORM's built-in `PropertyOptions` ensures better compatibility with the internal lifecycle hook systems and removes the buggy reflection extraction complexities of scanning custom external decorators during schema generation.

### 4. Constructing Complex Cypher Queries (`Neo4jQueryBuilder`)

The custom `Neo4jQueryBuilder` extends MikroORM principles and seamlessly bridges them to robust graph traversal queries via Cypher. 

#### Filtering & Relation traversal with `match` and `related`

```typescript
const qb = em.createQueryBuilder(User);

// Finds users named John Doe who created a specific post, and returns the post title
const result = await qb
  .match()
  .where('name', 'John Doe')
  .related(User, 'posts') // automatically extracts 'CREATED' relationship metadata
  .where('title', 'Graph Databases 101')
  .return(['title'])
  .execute();
```

#### Complex Multi-Path Traversals 

```typescript
const qb = em.createQueryBuilder(Actor);
const Cypher = qb.getCypher(); // Direct access to underlying @neo4j/cypher-builder toolkit

// Find actors who acted in "The Matrix" AND also directed it
const { cypher, params } = qb
  .match()
  .related(Actor, 'movies')
  .where('title', 'The Matrix')
  .match() // Starts a new MATCH statement linking the context
  // Use raw pattern building for complex graph spans
  .rawCypherPattern(new Cypher.Pattern(qb.getCurrentNode()).related(new Cypher.Relationship({ type: 'DIRECTED' })).to(new Cypher.Node({ labels: ['Movie'] })))
  .return(['name'])
  .build();
```

### 5. Read Replicas & Load Balancing

For large-scale applications, `@mikro-orm/neo4j` supports read-replicas out of the box. You can configure multiple read-only connections in `MikroORM.init()`.

```typescript
const orm = await MikroORM.init({
  clientUrl: 'bolt://primary:7687',
  user: 'neo4j',
  password: 'password',
  replicas: [
    { clientUrl: 'bolt://replica-1:7687', user: 'neo4j', password: 'password' },
    { clientUrl: 'bolt://replica-2:7687', user: 'neo4j', password: 'password' },
  ],
});
```

*   **Automatic Splitting**: By default, `em.find()` and `em.findOne()` operations will be automatically load-balanced across your replicas.
*   **Manual Control**: You can explicitly request a connection type if needed:
    ```typescript
    const readConn = em.getDriver().getConnection('read');
    const writeConn = em.getDriver().getConnection('write');
    ```

### 6. Transaction Management

Proper transactional support is essential for data integrity. `@mikro-orm/neo4j` fully supports MikroORM's transaction API.

#### Declarative Transactions

Use `em.transactional()` to wrap multiple operations in a single Neo4j transaction. If the callback throws, the transaction is automatically rolled back.

```typescript
await em.transactional(async (txEm) => {
  const user = txEm.create(User, { name: 'Alice' });
  txEm.persist(user);
  
  const post = txEm.create(Post, { title: 'First Post', author: user });
  txEm.persist(post);
  
  await txEm.flush();
});
```

#### Manual Transaction Control

```typescript
const fork = em.fork();
await fork.begin();
try {
  // ... operations
  await fork.commit();
} catch (e) {
  await fork.rollback();
  throw e;
}
```

### 7. Exception Handling

The driver automatically maps Neo4j-specific error codes to standard MikroORM exceptions:

| Exception | Neo4j Error Code Example |
| :--- | :--- |
| `UniqueConstraintViolationException` | `Neo.ClientError.Schema.ConstraintValidationFailed` |
| `NotNullConstraintViolationException` | `Neo.ClientError.Schema.PropertyExistenceError` |
| `SyntaxErrorException` | `Neo.ClientError.Statement.SyntaxError` |
| `ReadOnlyException` | `Neo.ClientError.Statement.AccessMode` (Write on Read Replica) |
| `DeadlockException` | `Neo.TransientError.Transaction.DeadlockDetected` |
| `ConnectionException` | `Neo.TransientError.Network.ConnectivityError` |

### 8. Schema Generation & GraphQL Support

The driver includes a `Neo4jSchemaGenerator` that can export your MikroORM metadata as a GraphQL SDL (Schema Definition Language) compatible with the `@neo4j/graphql` library.

This is particularly powerful for:
- 🤖 **AI-Ready Schemas**: AI agents and LLMs perform significantly better when provided with a detailed SDL including semantic descriptions.
- ⚡ **Instant APIs**: Generate a standard GraphQL schema for Neo4j based on your ORM models.

#### Generating SDL

You can access the generator through the standard MikroORM schema API:

```typescript
const sdl = orm.schema.getGraphSdl();
console.log(sdl);
```

#### Enrichment with `comment`

Both the decorator and functional APIs support a `comment` property. These comments are automatically translated into GraphQL docstrings (triple-quoted strings) in the generated SDL.

##### Decorator Approach

```typescript
@Entity({ comment: 'Represents a human user in the system.' })
export class User {
  @PrimaryKey()
  id!: string;

  @Property({ comment: 'The display name used in public profiles.' })
  name!: string;
}
```

##### Functional Approach

```typescript
export const ProductSchema = defineEntity({
  name: 'Product',
  comment: 'An item available for purchase.',
  properties(p) {
    return {
      id: p.uuid().primary(),
      price: p.number({ comment: 'Retail price in USD.' }),
    };
  },
});
```

#### Resulting SDL Example

```graphql
"""
An item available for purchase.
"""
type Product @node {
  id: ID!
  """
  Retail price in USD.
  """
  price: Float!
}
```

### 9. Advanced Usage

### Custom labels via `defineEntity`

You can specify multiple labels for an entity which will be used during query generation and node creation.

```typescript
const AuthorSchema = defineEntity({
  name: 'Author',
  labels: ['Author', 'Person'],
  properties(p) {
    return {
      id: p.uuid().primary(),
      name: p.string(),
    };
  },
});
```

### Running Raw Cypher

For raw parameterized queries, use `em.run()`:

```typescript
const users = await em.run(
  `MATCH (u:User)-[:CREATED]->(p:Post) WHERE p.title = $title RETURN u`,
  { title: 'Graph Databases 101' }
);
```

## Troubleshooting

### Node.js `globSync` SyntaxError

If you encounter `SyntaxError: The requested module 'node:fs' does not provide an export named 'globSync'`, it means you are running a version of Node.js older than **22.0.0**. 

**Solution**: Ensure your environment (including CI runners and Docker containers) is using Node.js **22+**.

### Running Workflows with `act` on Apple Silicon

When using [act](https://github.com/nektos/act) to test GitHub Actions locally on an Apple M-series (M1/M2/M3) chip, you may encounter an **exit code 137** (OOM or Architecture crash) during the `setup-node` step.

**Solution**: Specify the container architecture explicitly to avoid emulation crashes:

```bash
act --container-architecture linux/amd64
```

Additionally, ensure your Docker Desktop has at least **4GB-6GB** of RAM allocated in **Settings > Resources**.

## License

MIT License

## Author

Manuel Antunes
