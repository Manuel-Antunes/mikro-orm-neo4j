import { Collection, type Ref } from '@mikro-orm/core';
import { Entity, ManyToOne, OneToMany, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';
import crypto from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { MikroORM } from '../src/index.js';
import { setupNeo4jContainer, StartedNeo4jContainer } from './utils/setup-neo4j-container.js';

/**
 * Single-column PK entity. Used to prove `nativeInsert` is idempotent by PK
 * (C10): re-persisting the same `id` MERGEs into the existing node instead of
 * duplicating it.
 */
@Entity({ tableName: 'Widget' })
class Widget {
  @PrimaryKey({ type: 'string' })
  id!: string;

  @Property({ type: 'string' })
  name!: string;
}

/**
 * Composite-PK document `(id, tenant)`. Two tenants can share the same business
 * `id` — this is the exact shape that leaked cross-tenant (C11) when relations
 * matched endpoints on `id` alone.
 */
@Entity({ tableName: 'TDocument' })
class TDocument {
  @PrimaryKey({ type: 'string' })
  id!: string;

  @PrimaryKey({ type: 'string' })
  tenant!: string;

  @Property({ type: 'string' })
  title!: string;

  @OneToMany(() => Chunk, (chunk) => chunk.document)
  chunks = new Collection<Chunk>(this);
}

/** Composite-PK child pointing at a composite-PK parent via a graph relationship. */
@Entity({ tableName: 'Chunk' })
class Chunk {
  @PrimaryKey({ type: 'string' })
  id!: string;

  @PrimaryKey({ type: 'string' })
  tenant!: string;

  @Property({ type: 'string' })
  text!: string;

  @ManyToOne(() => TDocument, {
    ref: true,
    relationship: { type: 'PART_OF', direction: 'OUT' },
  })
  document!: Ref<TDocument>;
}

describe('MERGE idempotency (C10) + tenant-scoped relations (C11)', () => {
  let orm: MikroORM;
  let container: StartedNeo4jContainer;

  const countNodes = async (label: string, where: Record<string, unknown>): Promise<number> => {
    const conds = Object.keys(where)
      .map((k) => `n.${k} = $${k}`)
      .join(' AND ');
    const rows = await orm.em.run<{ c: number }>(
      `MATCH (n:${label})${conds ? ` WHERE ${conds}` : ''} RETURN count(n) as c`,
      where,
    );
    return Number(rows[0]?.c ?? 0);
  };

  beforeAll(async () => {
    const auth = { username: 'neo4j', password: 'testtest' };
    container = await setupNeo4jContainer(auth);
    orm = await MikroORM.init({
      clientUrl: container.connectionUri,
      entities: [Widget, TDocument, Chunk],
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
    orm.em.clear();
  });

  afterAll(async () => {
    await orm?.close(true);
    await container?.container?.stop();
    await container?.network?.stop();
  });

  describe('C10 — nativeInsert MERGEs by primary key', () => {
    test('re-persisting the same PK updates in place, does not duplicate', async () => {
      const id = crypto.randomUUID();

      orm.em.create(Widget, { id, name: 'v1' });
      await orm.em.flush();
      orm.em.clear();

      // Second projection of the SAME id — with CREATE this made a second node.
      orm.em.create(Widget, { id, name: 'v2' });
      await orm.em.flush();
      orm.em.clear();

      expect(await countNodes('Widget', { id })).toBe(1);

      const loaded = await orm.em.findOneOrFail(Widget, { id });
      expect(loaded.name).toBe('v2');
    });

    test('non-regression: two distinct PKs create two nodes', async () => {
      const a = crypto.randomUUID();
      const b = crypto.randomUUID();

      orm.em.create(Widget, { id: a, name: 'A' });
      orm.em.create(Widget, { id: b, name: 'B' });
      await orm.em.flush();
      orm.em.clear();

      expect(await countNodes('Widget', {})).toBe(2);
      expect(await countNodes('Widget', { id: a })).toBe(1);
      expect(await countNodes('Widget', { id: b })).toBe(1);
    });

    test('MERGE preserves properties that the second write omits', async () => {
      const id = crypto.randomUUID();

      orm.em.create(Widget, { id, name: 'kept' });
      await orm.em.flush();
      orm.em.clear();

      // Re-insert the same node again (idempotent projection of the same data).
      orm.em.create(Widget, { id, name: 'kept' });
      await orm.em.flush();
      orm.em.clear();

      expect(await countNodes('Widget', { id })).toBe(1);
      const loaded = await orm.em.findOneOrFail(Widget, { id });
      expect(loaded.name).toBe('kept');
    });
  });

  describe('C11 — relations match the full primary key', () => {
    test('a chunk links only to its own tenant, not the same id in another tenant', async () => {
      const sharedId = 'DOC-1';

      // Two documents sharing a business id across tenants.
      orm.em.create(TDocument, { id: sharedId, tenant: 'A', title: 'Doc A' });
      orm.em.create(TDocument, { id: sharedId, tenant: 'B', title: 'Doc B' });
      await orm.em.flush();
      orm.em.clear();

      const docA = await orm.em.findOneOrFail(TDocument, { id: sharedId, tenant: 'A' });

      // A chunk in tenant A pointing at tenant A's document.
      orm.em.create(Chunk, {
        id: crypto.randomUUID(),
        tenant: 'A',
        text: 'hello',
        document: orm.em.getReference(TDocument, [docA.id, docA.tenant] as any, { wrapped: true }),
      });
      await orm.em.flush();
      orm.em.clear();

      // Both endpoints matched on the FULL PK, so the edge lands on tenant A only.
      const edgesToA = await orm.em.run<{ c: number }>(
        `MATCH (:Chunk)-[:PART_OF]->(d:TDocument {id: $id, tenant: 'A'}) RETURN count(*) as c`,
        { id: sharedId },
      );
      const edgesToB = await orm.em.run<{ c: number }>(
        `MATCH (:Chunk)-[:PART_OF]->(d:TDocument {id: $id, tenant: 'B'}) RETURN count(*) as c`,
        { id: sharedId },
      );

      expect(Number(edgesToA[0].c)).toBe(1);
      // The bug: matching on id alone fanned the edge to BOTH docs — this was 1.
      expect(Number(edgesToB[0].c)).toBe(0);
    });

    test('composite-PK round-trip: persist, reload and navigate the relation', async () => {
      const doc = orm.em.create(TDocument, { id: 'DOC-RT', tenant: 'acme', title: 'Round trip' });
      orm.em.create(Chunk, {
        id: 'CHUNK-RT',
        tenant: 'acme',
        text: 'body',
        document: orm.em.getReference(TDocument, ['DOC-RT', 'acme'] as any, { wrapped: true }),
      });
      await orm.em.flush();
      orm.em.clear();

      void doc;

      const loaded = await orm.em.findOneOrFail(
        Chunk,
        { id: 'CHUNK-RT', tenant: 'acme' },
        { populate: ['document'] },
      );

      expect(loaded.text).toBe('body');
      expect(loaded.document.$.id).toBe('DOC-RT');
      expect(loaded.document.$.tenant).toBe('acme');
      expect(loaded.document.$.title).toBe('Round trip');
    });
  });
});
