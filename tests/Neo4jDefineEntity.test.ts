import { setupNeo4jContainer } from './utils/setup-neo4j-container.js';
import { MikroORM, defineEntity, neo4j } from '../src/index.js';
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';
import * as crypto from 'node:crypto';
import { StartedNeo4jContainer } from './utils/setup-neo4j-container.js';

// ---------------------------------------------------------------------------
// Schemas & Classes
// ---------------------------------------------------------------------------

// Category entity
const DefineCategorySchema = defineEntity({
  name: 'DefineCategory',
  properties(p) {
    return {
      // @ts-expect-error: bug in @mikro-orm/core
      id: p
        .uuid()
        .primary()
        .onCreate(() => crypto.randomUUID()),
      name: p.string(),
      products: () => p.oneToMany(DefineProductSchema as any).mappedBy('category'),
    };
  },
});

class DefineCategory extends (DefineCategorySchema.class as any) {
  get normalizedName(): string {
    return (this as any).name.trim().toLowerCase();
  }
}
DefineCategorySchema.setClass(DefineCategory as any);

// Product entity
const DefineProductSchema = defineEntity({
  name: 'DefineProduct',
  properties(p) {
    return {
      // @ts-expect-error: bug in @mikro-orm/core
      id: p
        .uuid()
        .primary()
        .onCreate(() => crypto.randomUUID()),
      name: p.string(),
      price: p.integer().nullable(),
      // ManyToOne with custom relationship type
      category: () =>
        neo4j(
          p
            .manyToOne(DefineCategorySchema as any)
            .ref()
            .nullable(),
          {
            type: 'BELONGS_TO',
            direction: 'OUT',
          },
        ),
      // ManyToMany (owner side) with custom relationship type
      peers: () =>
        neo4j(
          p
            .manyToMany(DefineProduct)
            .owner()
            .pivotEntity(() => DefineSimilaritySchema),
          {
            type: 'SIMILAR_TO',
            direction: 'OUT',
          },
        ),
      // ManyToMany with pivot entity for relationship properties
      tags: () =>
        neo4j(
          p
            .manyToMany(DefineTag)
            .owner()
            .pivotEntity(() => DefineProductTagSchema as any),
          {
            type: 'TAGGED_WITH',
            direction: 'OUT',
          },
        ),
    };
  },
});

class DefineProduct extends (DefineProductSchema.class as any) {
  get label(): string {
    return `${(this as any).name}:${(this as any).price ?? 0}`;
  }
}
DefineProductSchema.setClass(DefineProduct as any);

// Tag entity
const DefineTagSchema = defineEntity({
  name: 'DefineTag',
  properties(p) {
    return {
      // @ts-expect-error: bug in @mikro-orm/core
      id: p
        .uuid()
        .primary()
        .onCreate(() => crypto.randomUUID()),
      name: p.string(),
      products: () =>
        neo4j(p.manyToMany(DefineProductSchema as any).mappedBy('tags'), {
          type: 'TAGGED_WITH',
          direction: 'IN',
        }),
    };
  },
});

class DefineTag extends (DefineTagSchema.class as any) {}
DefineTagSchema.setClass(DefineTag as any);

// Pivot entity — relationship properties for TAGGED_WITH
const DefineProductTagSchema = defineEntity({
  name: 'DefineProductTag',
  relationship: { type: 'TAGGED_WITH' },
  properties(p) {
    return {
      // @ts-expect-error: bug in @mikro-orm/core
      id: p
        .uuid()
        .primary()
        .onCreate(() => crypto.randomUUID()),
      product: () => p.manyToOne(DefineProductSchema as any).primary(),
      tag: () => p.manyToOne(DefineTagSchema as any).primary(),
      addedAt: p.integer(),
    };
  },
});

class DefineProductTag extends (DefineProductTagSchema.class as any) {}
DefineProductTagSchema.setClass(DefineProductTag as any);

// Pivot entity — relationship properties for SIMILAR_TO
const DefineSimilaritySchema = defineEntity({
  name: 'DefineSimilarity',
  relationship: { type: 'SIMILAR_TO' },
  properties(p) {
    return {
      // @ts-expect-error: bug in @mikro-orm/core
      id: p
        .uuid()
        .primary()
        .onCreate(() => crypto.randomUUID()),
      score: p.integer(),
      from: () => p.manyToOne(DefineProductSchema as any),
      to: () => p.manyToOne(DefineProductSchema as any),
    };
  },
});

class DefineSimilarity extends (DefineSimilaritySchema.class as any) {}
DefineSimilaritySchema.setClass(DefineSimilarity as any);

// Author + Book for a cleaner directed-relationship example
const DefineAuthorSchema = defineEntity({
  name: 'DefineAuthor',
  labels: ['Author', 'Person'],
  properties(p) {
    return {
      // @ts-expect-error: bug in @mikro-orm/core
      id: p
        .uuid()
        .primary()
        .onCreate(() => crypto.randomUUID()),
      name: p.string(),
      books: () => p.oneToMany(DefineBook).mappedBy('author'),
    };
  },
});

class DefineAuthor extends (DefineAuthorSchema.class as any) {}
DefineAuthorSchema.setClass(DefineAuthor as any);

const DefineBookSchema = defineEntity({
  name: 'DefineBook',
  properties(p) {
    return {
      // @ts-expect-error: bug in @mikro-orm/core
      id: p
        .uuid()
        .primary()
        .onCreate(() => crypto.randomUUID()),
      title: p.string(),
      year: p.integer(),
      author: () =>
        neo4j(
          p
            .manyToOne(DefineAuthorSchema as any)
            .ref()
            .nullable(),
          {
            type: 'WROTE',
            direction: 'IN',
          },
        ),
    };
  },
});

class DefineBook extends (DefineBookSchema.class as any) {}
DefineBookSchema.setClass(DefineBook as any);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Neo4j defineEntity strategy (v7)', () => {
  let orm: MikroORM;
  let container: StartedNeo4jContainer;

  beforeAll(async () => {
    const auth = {
      username: 'neo4j',
      password: 'testtest',
    };

    container = await setupNeo4jContainer(auth);
    orm = await MikroORM.init({
      clientUrl: container.connectionUri,
      entities: [
        DefineCategorySchema as any,
        DefineProductSchema as any,
        DefineTagSchema as any,
        DefineProductTagSchema as any,
        DefineAuthorSchema as any,
        DefineBookSchema as any,
        DefineSimilaritySchema as any,
      ],
      dbName: 'neo4j',
      user: auth.username,
      password: auth.password,
      ensureDatabase: false,
      metadataProvider: TsMorphMetadataProvider,
      allowGlobalContext: true,
    });
  }, 500000);

  beforeEach(async () => {
    await orm.schema.clearDatabase();
  });

  afterAll(async () => {
    await orm?.close(true);
    await container?.container?.stop();
    await container?.network?.stop();
  });

  // ─── Original tests ────────────────────────────────────────────────────────

  test('supports defineEntity class assignment and relation resolution', async () => {
    const category = orm.em.create(DefineCategorySchema, { name: 'Books' } as any);
    const product = orm.em.create(DefineProductSchema, {
      name: 'Graph Databases 101',
      price: 42,
      category,
    } as any);

    await orm.em.persist([category, product]).flush();
    orm.em.clear();

    const loaded = await orm.em.findOneOrFail(
      DefineProductSchema,
      { id: (product as any).id },
      { populate: ['category'] },
    );

    expect((loaded as any).name).toBe('Graph Databases 101');
    expect((loaded as any).category?.$.name).toBe('Books');
    expect(((loaded as any).category?.$ as DefineCategory).normalizedName).toBe('books');
  });

  test('supports $or filters with defineEntity models', async () => {
    const expensive = orm.em.create(DefineProductSchema, { name: 'Laptop', price: 3000 } as any);
    const cheap = orm.em.create(DefineProductSchema, { name: 'Mouse', price: 30 } as any);
    const named = orm.em.create(DefineProductSchema, { name: 'Keyboard', price: 90 } as any);

    await orm.em.persist([expensive, cheap, named]).flush();

    const results = await orm.em.find(DefineProductSchema, {
      $or: [{ name: 'Keyboard' }, { price: { $gt: 1000 } }],
    } as any);

    expect(results.map((p) => (p as any).name).sort()).toEqual(['Keyboard', 'Laptop']);
  });

  // ─── ManyToOne with custom relationship type ───────────────────────────────

  describe('ManyToOne with custom relationship type', () => {
    test('persists and populates ManyToOne with BELONGS_TO relationship', async () => {
      const category = orm.em.create(DefineCategorySchema, { name: 'Fiction' } as any);
      const product = orm.em.create(DefineProductSchema, {
        name: 'Dune',
        price: 15,
        category,
      } as any);

      await orm.em.persist([category, product]).flush();

      // Verify via raw Cypher that the relationship type is BELONGS_TO
      const raw = await orm.em.run<{ relType: string }>(
        `MATCH (p:define_product)-[r]->(c:define_category)
         WHERE p.id = $id
         RETURN type(r) as relType`,
        { id: (product as any).id },
      );

      expect(raw).toHaveLength(1);
      expect(raw[0].relType).toBe('BELONGS_TO');

      orm.em.clear();

      // Verify ORM-level population
      const loaded = await orm.em.findOneOrFail(
        DefineProductSchema,
        { id: (product as any).id },
        { populate: ['category'] },
      );
      expect((loaded as any).category?.$.name).toBe('Fiction');
    });

    test('populates OneToMany inverse via custom relationship', async () => {
      const category = orm.em.create(DefineCategorySchema, { name: 'Science' } as any);
      const p1 = orm.em.create(DefineProductSchema, {
        name: 'Physics 101',
        price: 20,
        category,
      } as any);
      const p2 = orm.em.create(DefineProductSchema, {
        name: 'Chemistry',
        price: 18,
        category,
      } as any);

      await orm.em.persist([category, p1, p2]).flush();
      orm.em.clear();

      const loadedCategory = await orm.em.findOneOrFail(
        DefineCategorySchema,
        { id: (category as any).id },
        { populate: ['products'] },
      );

      expect((loadedCategory as any).products.length).toBe(2);
      const names = (loadedCategory as any).products
        .getItems()
        .map((p: any) => p.name)
        .sort();
      expect(names).toEqual(['Chemistry', 'Physics 101']);
    });
  });

  // ─── ManyToMany with direction ─────────────────────────────────────────────

  describe('ManyToMany with custom relationship type and direction', () => {
    test('persists ManyToMany with SIMILAR_TO relationship type', async () => {
      const a = orm.em.create(DefineProductSchema, { name: 'Product A', price: 10 } as any);
      const b = orm.em.create(DefineProductSchema, { name: 'Product B', price: 20 } as any);
      const c = orm.em.create(DefineProductSchema, { name: 'Product C', price: 30 } as any);
      (a as any).peers.add(b, c);

      await orm.em.persistAndFlush([a, b, c]);

      // Raw check — relationship should be SIMILAR_TO
      const raw = await orm.em.run<{ relType: string; targetName: string }>(
        `MATCH (a:define_product)-[r]->(b:define_product)
         WHERE a.id = $id
         RETURN type(r) as relType, b.name as targetName
         ORDER BY b.name`,
        { id: (a as any).id },
      );

      expect(raw).toHaveLength(2);
      expect(raw[0].relType).toBe('SIMILAR_TO');
      expect(raw[1].relType).toBe('SIMILAR_TO');
      expect(raw.map((r) => r.targetName).sort()).toEqual(['Product B', 'Product C']);
    });

    test('populates ManyToMany collection via ORM', async () => {
      const a = orm.em.create(DefineProductSchema, { name: 'Anchor', price: 5 } as any);
      const x = orm.em.create(DefineProductSchema, { name: 'X', price: 5 } as any);
      const y = orm.em.create(DefineProductSchema, { name: 'Y', price: 5 } as any);
      (a as any).peers.add(x, y);

      await orm.em.persistAndFlush([a, x, y]);
      orm.em.clear();

      const loaded = await orm.em.findOneOrFail(
        DefineProductSchema,
        { id: (a as any).id },
        { populate: ['peers'] },
      );
      expect((loaded as any).peers.length).toBe(2);
    });
  });

  // ─── Pivot entity (relationship properties) ────────────────────────────────

  describe('Pivot entity as relationship properties (TAGGED_WITH)', () => {
    test('persists and reads relationship properties through pivot entity', async () => {
      const product = orm.em.create(DefineProductSchema, {
        name: 'Smart Speaker',
        price: 99,
      } as any);
      const tag = orm.em.create(DefineTagSchema, { name: 'iot' } as any);
      const pivot = orm.em.create(DefineProductTagSchema, {
        product,
        tag,
        addedAt: 1700000000,
      } as any);

      await orm.em.persistAndFlush([product, tag, pivot]);

      // Verify raw relationship type and properties
      const raw = await orm.em.run<{ relType: string; addedAt: number }>(
        `MATCH (p:define_product)-[r:TAGGED_WITH]->(t:define_tag)
         WHERE p.id = $id
         RETURN type(r) as relType, r.addedAt as addedAt`,
        { id: (product as any).id },
      );

      expect(raw).toHaveLength(1);
      expect(raw[0].relType).toBe('TAGGED_WITH');
      expect(Number(raw[0].addedAt)).toBe(1700000000);
    });

    test('queries relationship properties via raw Cypher', async () => {
      const product = orm.em.create(DefineProductSchema, { name: 'Headphones', price: 250 } as any);
      const tagA = orm.em.create(DefineTagSchema, { name: 'audio' } as any);
      const tagB = orm.em.create(DefineTagSchema, { name: 'wireless' } as any);

      const pivotA = orm.em.create(DefineProductTagSchema, {
        product,
        tag: tagA,
        addedAt: 1000,
      } as any);
      const pivotB = orm.em.create(DefineProductTagSchema, {
        product,
        tag: tagB,
        addedAt: 2000,
      } as any);

      await orm.em.persistAndFlush([product, tagA, tagB, pivotA, pivotB]);
      orm.em.clear();

      // Pivot entities are stored as relationship data in Neo4j, query via Cypher
      const rels = await orm.em.run<{ addedAt: number; tagName: string }>(
        `MATCH (p:define_product)-[r:TAGGED_WITH]->(t:define_tag)
         WHERE p.id = $id
         RETURN r.addedAt as addedAt, t.name as tagName
         ORDER BY r.addedAt`,
        { id: (product as any).id },
      );
      expect(rels).toHaveLength(2);
      expect(rels.map((r) => Number(r.addedAt))).toEqual([1000, 2000]);
    });
  });

  // ─── Custom labels via defineEntity ───────────────────────────────────────

  describe('Custom entity labels via defineNeo4jEntity', () => {
    test('creates nodes with correct collection label', async () => {
      const author = orm.em.create(DefineAuthorSchema, { name: 'Frank Herbert' } as any);
      await orm.em.persistAndFlush(author);

      // Node should be labelled 'define_author' (the collection name — snake_case of DefineAuthor)
      const raw = await orm.em.run<{ found: boolean }>(
        `MATCH (a:define_author {id: $id}) RETURN true as found`,
        { id: (author as any).id },
      );
      expect(raw).toHaveLength(1);
      expect(raw[0].found).toBe(true);
    });
  });

  // ─── Directed relationships with Author → Book ────────────────────────────

  describe('Directed relationships: Author WROTE Book', () => {
    test('persists directed WROTE relationship from author to book', async () => {
      const author = orm.em.create(DefineAuthorSchema, { name: 'Isaac Asimov' } as any);
      const book = orm.em.create(DefineBookSchema, {
        title: 'Foundation',
        year: 1951,
        author,
      } as any);

      await orm.em.persistAndFlush([author, book]);

      // Verify raw relationship type and direction
      const raw = await orm.em.run<{ relType: string }>(
        `MATCH (a:define_author)-[r]->(b:define_book)
         WHERE a.id = $id
         RETURN type(r) as relType`,
        { id: (author as any).id },
      );

      expect(raw).toHaveLength(1);
      expect(raw[0].relType).toBe('WROTE');
    });
  });
});
