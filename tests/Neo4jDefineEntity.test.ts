import crypto from 'node:crypto';
import { defineEntity } from '@mikro-orm/core';
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';
import { MikroORM } from '@mikro-orm/neo4j';
import {
  setupNeo4jContainer,
  type StartedNeo4jContainer,
} from '../src/utils/test/setup-neo4j-container';

const DefineCategorySchema = defineEntity({
  name: 'DefineCategory',
  properties(p) {
    return {
      id: p.uuid().primary().onCreate(() => crypto.randomUUID()),
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
      id: p.uuid().primary().onCreate(() => crypto.randomUUID()),
      name: p.string(),
      price: p.integer().nullable(),
      category: () => p.manyToOne(DefineCategorySchema).ref().nullable(),
      peers: () => p.manyToMany(DefineProductSchema).owner(),
    };
  },
});

class DefineProduct extends DefineProductSchema.class {
  get label(): string {
    return `${this.name}:${this.price ?? 0}`;
  }
}
DefineProductSchema.setClass(DefineProduct);

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
      entities: [DefineCategorySchema, DefineProductSchema],
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
});
