import crypto from 'node:crypto';
import { defineEntity } from '@mikro-orm/core';
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';
import { MikroORM } from '../src/index.js';
import { setupNeo4jContainer, type StartedNeo4jContainer } from './utils/setup-neo4j-container.js';
import { defineNeo4jEntity, neo4j } from '../src/defineNeo4jEntity.js';

// ---------------------------------------------------------------------------
// Schema definitions using defineNeo4jEntity + neo4j() helpers
// ---------------------------------------------------------------------------

const DefineCategorySchema = defineEntity({
  name: 'DefineCategory',
  properties(p) {
    return {
      id: p
        .uuid()
        .primary()
        .onCreate(() => crypto.randomUUID()),
      name: p.string(),
      products: () => p.oneToMany(DefineProductSchema).mappedBy('category'),
    };
  },
});

class DefineCategory extends DefineCategorySchema.class {
  get normalizedName(): string {
    return this.name.trim().toLowerCase();
  }
}
DefineCategorySchema.setClass(DefineCategory);

const DefineProductSchema = defineEntity({
  name: 'DefineProduct',
  properties(p) {
    return {
      id: p
        .uuid()
        .primary()
        .onCreate(() => crypto.randomUUID()),
      name: p.string(),
      price: p.integer().nullable(),
      // ManyToOne with custom relationship type
      category: () =>
        neo4j(p.manyToOne(DefineCategorySchema).ref().nullable(), {
          type: 'BELONGS_TO',
          direction: 'OUT',
        }),
      // ManyToMany (owner side) with custom relationship type
      peers: () =>
        neo4j(p.manyToMany(DefineProductSchema).owner(), {
          type: 'SIMILAR_TO',
          direction: 'OUT',
        }),
      // ManyToMany with pivot entity for relationship properties
      tags: () =>
        neo4j(p.manyToMany(DefineTagSchema).owner().pivotEntity(DefineProductTagSchema), {
          type: 'TAGGED_WITH',
          direction: 'OUT',
        }),
    };
  },
});

class DefineProduct extends DefineProductSchema.class {
  get label(): string {
    return `${this.name}:${this.price ?? 0}`;
  }
}
DefineProductSchema.setClass(DefineProduct);

// Tag entity
const DefineTagSchema = defineEntity({
  name: 'DefineTag',
  properties(p) {
    return {
      id: p
        .uuid()
        .primary()
        .onCreate(() => crypto.randomUUID()),
      name: p.string(),
      products: () =>
        neo4j(p.manyToMany(DefineProductSchema).mappedBy('tags'), {
          type: 'TAGGED_WITH',
          direction: 'IN',
        }),
    };
  },
});

class DefineTag extends DefineTagSchema.class {}
DefineTagSchema.setClass(DefineTag);

// Pivot entity — relationship properties for TAGGED_WITH
const DefineProductTagSchema = defineNeo4jEntity({
  name: 'DefineProductTag',
  neo4j: { relationshipEntity: true, type: 'TAGGED_WITH' },
  properties(p) {
    return {
      id: p
        .uuid()
        .primary()
        .onCreate(() => crypto.randomUUID()),
      product: () => p.manyToOne(DefineProductSchema).primary(),
      tag: () => p.manyToOne(DefineTagSchema).primary(),
      addedAt: p.integer(), // Unix timestamp
    };
  },
});

class DefineProductTag extends DefineProductTagSchema.class {}
DefineProductTagSchema.setClass(DefineProductTag);

// Author + Book for a cleaner directed-relationship example
const DefineAuthorSchema = defineNeo4jEntity({
  name: 'DefineAuthor',
  // Demonstrates custom entity-level labels via defineNeo4jEntity
  neo4j: { labels: ['Author', 'Person'] },
  properties(p) {
    return {
      id: p
        .uuid()
        .primary()
        .onCreate(() => crypto.randomUUID()),
      name: p.string(),
      books: () =>
        neo4j(p.oneToMany(DefineBookSchema).mappedBy('author'), {
          type: 'WROTE',
          direction: 'OUT',
        }),
    };
  },
});

class DefineAuthor extends DefineAuthorSchema.class {}
DefineAuthorSchema.setClass(DefineAuthor);

const DefineBookSchema = defineEntity({
  name: 'DefineBook',
  properties(p) {
    return {
      id: p
        .uuid()
        .primary()
        .onCreate(() => crypto.randomUUID()),
      title: p.string(),
      year: p.integer().nullable(),
      author: () =>
        neo4j(p.manyToOne(DefineAuthorSchema).ref(), {
          type: 'WROTE',
          direction: 'IN',
        }),
    };
  },
});

class DefineBook extends DefineBookSchema.class {}
DefineBookSchema.setClass(DefineBook);

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
        DefineCategorySchema,
        DefineProductSchema,
        DefineTagSchema,
        DefineProductTagSchema,
        DefineAuthorSchema,
        DefineBookSchema,
      ],
      dbName: 'neo4j',
      user: auth.username,
      password: auth.password,
      ensureDatabase: false,
      metadataProvider: TsMorphMetadataProvider,
      allowGlobalContext: true,
    });
  });

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
    const category = orm.em.create(DefineCategorySchema, { name: 'Books' });
    const product = orm.em.create(DefineProductSchema, {
      name: 'Graph Databases 101',
      price: 42,
      category,
    });

    await orm.em.persist([category, product]).flush();
    orm.em.clear();

    const loaded = await orm.em.findOneOrFail(
      DefineProductSchema,
      { id: product.id },
      { populate: ['category'] },
    );

    expect(loaded.name).toBe('Graph Databases 101');
    expect(loaded.category?.$.name).toBe('Books');
    expect(loaded.category?.$.normalizedName).toBe('books');
  });

  test('supports $or filters with defineEntity models', async () => {
    const expensive = orm.em.create(DefineProductSchema, { name: 'Laptop', price: 3000 });
    const cheap = orm.em.create(DefineProductSchema, { name: 'Mouse', price: 30 });
    const named = orm.em.create(DefineProductSchema, { name: 'Keyboard', price: 90 });

    await orm.em.persist([expensive, cheap, named]).flush();

    const results = await orm.em.find(DefineProductSchema, {
      $or: [{ name: 'Keyboard' }, { price: { $gt: 1000 } }],
    } as any);

    expect(results.map((p) => p.name).sort()).toEqual(['Keyboard', 'Laptop']);
  });

  // ─── ManyToOne with custom relationship type ───────────────────────────────

  describe('ManyToOne with custom relationship type', () => {
    test('persists and populates ManyToOne with BELONGS_TO relationship', async () => {
      const category = orm.em.create(DefineCategorySchema, { name: 'Fiction' });
      const product = orm.em.create(DefineProductSchema, {
        name: 'Dune',
        price: 15,
        category,
      });

      await orm.em.persist([category, product]).flush();

      // Verify via raw Cypher that the relationship type is BELONGS_TO
      const raw = await orm.em.run<{ relType: string }>(
        `MATCH (p:define_product)-[r]->(c:define_category)
         WHERE p.id = $id
         RETURN type(r) as relType`,
        { id: product.id },
      );

      expect(raw).toHaveLength(1);
      expect(raw[0].relType).toBe('BELONGS_TO');

      orm.em.clear();

      // Verify ORM-level population
      const loaded = await orm.em.findOneOrFail(
        DefineProductSchema,
        { id: product.id },
        { populate: ['category'] },
      );
      expect(loaded.category?.$.name).toBe('Fiction');
    });

    test('populates OneToMany inverse via custom relationship', async () => {
      const category = orm.em.create(DefineCategorySchema, { name: 'Science' });
      const p1 = orm.em.create(DefineProductSchema, { name: 'Physics 101', price: 20, category });
      const p2 = orm.em.create(DefineProductSchema, { name: 'Chemistry', price: 18, category });

      await orm.em.persist([category, p1, p2]).flush();
      orm.em.clear();

      const loadedCategory = await orm.em.findOneOrFail(
        DefineCategorySchema,
        { id: category.id },
        { populate: ['products'] },
      );

      expect(loadedCategory.products.length).toBe(2);
      const names = loadedCategory.products
        .getItems()
        .map((p) => p.name)
        .sort();
      expect(names).toEqual(['Chemistry', 'Physics 101']);
    });
  });

  // ─── ManyToMany with direction ─────────────────────────────────────────────

  describe('ManyToMany with custom relationship type and direction', () => {
    test('persists ManyToMany with SIMILAR_TO relationship type', async () => {
      const a = orm.em.create(DefineProductSchema, { name: 'Product A', price: 10 });
      const b = orm.em.create(DefineProductSchema, { name: 'Product B', price: 20 });
      const c = orm.em.create(DefineProductSchema, { name: 'Product C', price: 30 });
      a.peers.add(b, c);

      await orm.em.persistAndFlush([a, b, c]);

      // Raw check — relationship should be SIMILAR_TO
      const raw = await orm.em.run<{ relType: string; targetName: string }>(
        `MATCH (a:define_product)-[r]->(b:define_product)
         WHERE a.id = $id
         RETURN type(r) as relType, b.name as targetName
         ORDER BY b.name`,
        { id: a.id },
      );

      expect(raw).toHaveLength(2);
      expect(raw[0].relType).toBe('SIMILAR_TO');
      expect(raw[1].relType).toBe('SIMILAR_TO');
      expect(raw.map((r) => r.targetName).sort()).toEqual(['Product B', 'Product C']);
    });

    test('populates ManyToMany collection via ORM', async () => {
      const a = orm.em.create(DefineProductSchema, { name: 'Anchor', price: 5 });
      const x = orm.em.create(DefineProductSchema, { name: 'X', price: 5 });
      const y = orm.em.create(DefineProductSchema, { name: 'Y', price: 5 });
      a.peers.add(x, y);

      await orm.em.persistAndFlush([a, x, y]);
      orm.em.clear();

      const loaded = await orm.em.findOneOrFail(
        DefineProductSchema,
        { id: a.id },
        { populate: ['peers'] },
      );
      expect(loaded.peers.length).toBe(2);
    });
  });

  // ─── Pivot entity (relationship properties) ────────────────────────────────

  describe('Pivot entity as relationship properties (TAGGED_WITH)', () => {
    test('persists and reads relationship properties through pivot entity', async () => {
      const product = orm.em.create(DefineProductSchema, { name: 'Smart Speaker', price: 99 });
      const tag = orm.em.create(DefineTagSchema, { name: 'iot' });
      const pivot = orm.em.create(DefineProductTagSchema, {
        product,
        tag,
        addedAt: 1700000000,
      });

      await orm.em.persistAndFlush([product, tag, pivot]);

      // Verify raw relationship type and properties
      const raw = await orm.em.run<{ relType: string; addedAt: number }>(
        `MATCH (p:define_product)-[r:TAGGED_WITH]->(t:define_tag)
         WHERE p.id = $id
         RETURN type(r) as relType, r.addedAt as addedAt`,
        { id: product.id },
      );

      expect(raw).toHaveLength(1);
      expect(raw[0].relType).toBe('TAGGED_WITH');
      expect(Number(raw[0].addedAt)).toBe(1700000000);
    });

    test('queries relationship properties via raw Cypher', async () => {
      const product = orm.em.create(DefineProductSchema, { name: 'Headphones', price: 250 });
      const tagA = orm.em.create(DefineTagSchema, { name: 'audio' });
      const tagB = orm.em.create(DefineTagSchema, { name: 'wireless' });

      const pivotA = orm.em.create(DefineProductTagSchema, {
        product,
        tag: tagA,
        addedAt: 1000,
      });
      const pivotB = orm.em.create(DefineProductTagSchema, {
        product,
        tag: tagB,
        addedAt: 2000,
      });

      await orm.em.persistAndFlush([product, tagA, tagB, pivotA, pivotB]);
      orm.em.clear();

      // Pivot entities are stored as relationship data in Neo4j, query via Cypher
      const rels = await orm.em.run<{ addedAt: number; tagName: string }>(
        `MATCH (p:define_product)-[r:TAGGED_WITH]->(t:define_tag)
         WHERE p.id = $id
         RETURN r.addedAt as addedAt, t.name as tagName
         ORDER BY r.addedAt`,
        { id: product.id },
      );
      expect(rels).toHaveLength(2);
      expect(rels.map((r) => Number(r.addedAt))).toEqual([1000, 2000]);
    });
  });

  // ─── Custom labels via defineEntity ───────────────────────────────────────

  describe('Custom entity labels via defineNeo4jEntity', () => {
    test('creates nodes with correct collection label', async () => {
      const author = orm.em.create(DefineAuthorSchema, { name: 'Frank Herbert' });
      await orm.em.persistAndFlush(author);

      // Node should be labelled 'define_author' (the collection name — snake_case of DefineAuthor)
      const raw = await orm.em.run<{ found: boolean }>(
        `MATCH (a:define_author {id: $id}) RETURN true as found`,
        { id: author.id },
      );
      expect(raw).toHaveLength(1);
      expect(raw[0].found).toBe(true);
    });
  });

  // ─── Directed relationships with Author → Book ────────────────────────────

  describe('Directed relationships: Author WROTE Book', () => {
    test('persists directed WROTE relationship from author to book', async () => {
      const author = orm.em.create(DefineAuthorSchema, { name: 'Isaac Asimov' });
      const book = orm.em.create(DefineBookSchema, { title: 'Foundation', year: 1951, author });

      await orm.em.persistAndFlush([author, book]);

      const raw = await orm.em.run<{ relType: string }>(
        `MATCH (a:define_author)-[r]->(b:define_book)
         WHERE a.id = $id
         RETURN type(r) as relType`,
        { id: author.id },
      );

      expect(raw).toHaveLength(1);
      expect(raw[0].relType).toBe('WROTE');
    });

    test('populates book.author via ManyToOne', async () => {
      const author = orm.em.create(DefineAuthorSchema, { name: 'Ursula K. Le Guin' });
      const book = orm.em.create(DefineBookSchema, {
        title: 'The Left Hand of Darkness',
        year: 1969,
        author,
      });

      await orm.em.persistAndFlush([author, book]);
      orm.em.clear();

      const loaded = await orm.em.findOneOrFail(
        DefineBookSchema,
        { id: book.id },
        { populate: ['author'] },
      );
      expect(loaded.author?.$.name).toBe('Ursula K. Le Guin');
    });

    test('populates author.books OneToMany collection', async () => {
      const author = orm.em.create(DefineAuthorSchema, { name: 'Philip K. Dick' });
      const b1 = orm.em.create(DefineBookSchema, {
        title: 'Do Androids Dream?',
        year: 1968,
        author,
      });
      const b2 = orm.em.create(DefineBookSchema, { title: 'Ubik', year: 1969, author });

      await orm.em.persistAndFlush([author, b1, b2]);
      orm.em.clear();

      const loaded = await orm.em.findOneOrFail(
        DefineAuthorSchema,
        { id: author.id },
        { populate: ['books'] },
      );
      expect(loaded.books.length).toBe(2);
      const titles = loaded.books
        .getItems()
        .map((b) => b.title)
        .sort();
      expect(titles).toEqual(['Do Androids Dream?', 'Ubik']);
    });
  });

  // ─── QueryBuilder with defineEntity schemas ───────────────────────────────

  describe('QueryBuilder related() with defineEntity schemas', () => {
    test('builds MATCH with relationship via related(Schema, propName)', async () => {
      const author = orm.em.create(DefineAuthorSchema, { name: 'Arthur C. Clarke' });
      const book = orm.em.create(DefineBookSchema, {
        title: '2001: A Space Odyssey',
        year: 1968,
        author,
      });

      await orm.em.persistAndFlush([author, book]);
      orm.em.clear();

      const qb = orm.em.createQueryBuilder(DefineBookSchema);
      const { cypher } = qb.match().related(DefineBookSchema, 'author').return(['title']).build();

      expect(cypher).toContain('MATCH');
      expect(cypher).toContain('WROTE');
      expect(cypher).toContain('define_book');
    });

    test('executes related query and returns results', async () => {
      const author = orm.em.create(DefineAuthorSchema, { name: 'Ray Bradbury' });
      const b1 = orm.em.create(DefineBookSchema, { title: 'Fahrenheit 451', year: 1953, author });
      const b2 = orm.em.create(DefineBookSchema, {
        title: 'The Martian Chronicles',
        year: 1950,
        author,
      });

      await orm.em.persistAndFlush([author, b1, b2]);
      orm.em.clear();

      // Fetch all books authored by Ray Bradbury via raw Cypher
      const results = await orm.em.run<{ title: string }>(
        `MATCH (a:define_author {name: $name})-[:WROTE]->(b:define_book)
         RETURN b.title as title ORDER BY b.title`,
        { name: 'Ray Bradbury' },
      );

      expect(results).toHaveLength(2);
      expect(results[0].title).toBe('Fahrenheit 451');
      expect(results[1].title).toBe('The Martian Chronicles');
    });

    test('QueryBuilder produces correct relationship type from custom metadata', () => {
      const qb = orm.em.createQueryBuilder(DefineProductSchema);
      const { cypher } = qb.match().related(DefineProductSchema, 'peers').return(['name']).build();

      expect(cypher).toContain('SIMILAR_TO');
    });

    test('throws error when related() called with unknown property', () => {
      const qb = orm.em.createQueryBuilder(DefineProductSchema);
      expect(() => {
        qb.match().related(DefineProductSchema, 'nonExistentProperty').build();
      }).toThrow(/No relationship metadata found/);
    });
  });
});
