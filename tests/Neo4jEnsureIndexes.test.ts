import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  Entity,
  Index,
  ManyToOne,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { defineEntity, MikroORM, Neo4jEntityManager } from '../src/index.js';
import { setupNeo4jContainer, StartedNeo4jContainer } from './utils/setup-neo4j-container.js';

/**
 * `plainCamelCase` is the trap this suite exists for: the default naming strategy derives the
 * field name `plain_camel_case`, but the driver writes the node property by JS key.
 */
@Entity({ tableName: 'Document' })
@Index({ properties: ['tenant', 'id'] })
@Index({ properties: ['plainCamelCase'] })
@Index({ properties: ['title'], type: 'text', name: 'document_title_text' })
class Document {
  @PrimaryKey({ type: 'string' })
  id: string = crypto.randomUUID();

  @Property({ type: 'string' })
  tenant!: string;

  @Property({ type: 'string' })
  plainCamelCase!: string;

  @Property({ type: 'string' })
  title!: string;
}

@Entity({ tableName: 'Party', labels: ['Party', 'JudgmentCreditor'] })
@Index({ properties: ['tenant'] })
@Unique({ properties: ['tenant', 'cpf'] })
class Party {
  @PrimaryKey({ type: 'string' })
  id: string = crypto.randomUUID();

  @Property({ type: 'string' })
  tenant!: string;

  @Property({ type: 'string' })
  cpf!: string;
}

@Entity({ tableName: 'Actor' })
class Actor {
  @PrimaryKey({ type: 'string' })
  id: string = crypto.randomUUID();

  @Property({ type: 'string' })
  name!: string;
}

@Entity({ tableName: 'Film' })
class Film {
  @PrimaryKey({ type: 'string' })
  id: string = crypto.randomUUID();

  @Property({ type: 'string' })
  title!: string;
}

@Entity({ relationship: { type: 'ACTED_IN' } })
@Index({ properties: ['billing'] })
class ActedIn {
  @PrimaryKey({ type: 'string' })
  id: string = crypto.randomUUID();

  @ManyToOne(() => Actor, { primary: true })
  actor!: Actor;

  @ManyToOne(() => Film, { primary: true })
  film!: Film;

  @Property({ type: 'number' })
  billing!: number;
}

/** A flattened property whose JS key contains a dot; only backticks keep Cypher from nesting it. */
const DottedSchema = defineEntity({
  name: 'Dotted',
  tableName: 'Dotted',
  properties: (p) => ({
    id: p.string().primary(),
    'address.city': p.string(),
  }),
  indexes: [{ properties: ['address.city'] }],
});

interface IndexRow {
  name: string;
  entityType: string;
  labelsOrTypes: string[];
  properties: string[];
  type: string;
}

describe('Neo4jSchemaGenerator.ensureIndexes()', () => {
  let orm: MikroORM;
  let container: StartedNeo4jContainer;

  const showIndexes = async (): Promise<IndexRow[]> => {
    const em = orm.em as Neo4jEntityManager;
    const result = await em.getDriver().getConnection('write').executeRaw('SHOW INDEXES', {});
    return result.records.map((record: { toObject: () => IndexRow }) => record.toObject());
  };

  const showConstraints = async (): Promise<IndexRow[]> => {
    const em = orm.em as Neo4jEntityManager;
    const result = await em.getDriver().getConnection('write').executeRaw('SHOW CONSTRAINTS', {});
    return result.records.map((record: { toObject: () => IndexRow }) => record.toObject());
  };

  const findIndex = async (name: string) => (await showIndexes()).find((row) => row.name === name);

  beforeAll(async () => {
    const auth = { username: 'neo4j', password: 'testtest' };
    container = await setupNeo4jContainer(auth);
    orm = await MikroORM.init({
      clientUrl: container.connectionUri,
      entities: [Document, Party, Actor, Film, ActedIn, DottedSchema],
      dbName: 'neo4j',
      user: auth.username,
      password: auth.password,
      ensureDatabase: false,
      allowGlobalContext: true,
    });

    await orm.schema.ensureIndexes();
  }, 500000);

  afterAll(async () => {
    await orm?.close(true);
    await container?.container?.stop();
    await container?.network?.stop();
  });

  test('indexes the JS property name, not the derived field name', async () => {
    const index = await findIndex('Document_plainCamelCase_idx');

    // Had the generator used fieldNames, this would read ['plain_camel_case'] — an index over a
    // property no node carries: created successfully, never used, never noticed.
    expect(index?.properties).toEqual(['plainCamelCase']);
    expect(index?.labelsOrTypes).toEqual(['Document']);
  });

  test('is idempotent — running twice changes nothing and raises nothing', async () => {
    const before = await showIndexes();

    await orm.schema.ensureIndexes();
    await orm.schema.ensureIndexes();

    const after = await showIndexes();
    expect(after.map((row) => row.name).sort()).toEqual(before.map((row) => row.name).sort());
  });

  test('preserves composite property order', async () => {
    const index = await findIndex('Document_tenant_id_idx');

    expect(index?.properties).toEqual(['tenant', 'id']);
    expect(index?.type).toBe('RANGE');
  });

  test('creates a TEXT index when asked for one', async () => {
    const index = await findIndex('document_title_text');

    expect(index?.type).toBe('TEXT');
    expect(index?.properties).toEqual(['title']);
  });

  test('survives a dotted property name', async () => {
    const index = await findIndex('Dotted_address_city_idx');

    expect(index?.properties).toEqual(['address.city']);
    expect(index?.labelsOrTypes).toEqual(['Dotted']);
  });

  test('indexes only the primary label of a multi-label entity', async () => {
    const indexes = await showIndexes();
    const partyIndexes = indexes.filter((row) => row.labelsOrTypes?.includes('Party'));

    expect(partyIndexes.map((row) => row.name)).toContain('Party_tenant_idx');
    expect(indexes.some((row) => row.labelsOrTypes?.includes('JudgmentCreditor'))).toBe(false);
  });

  test('creates a unique constraint and enforces it', async () => {
    const constraint = (await showConstraints()).find(
      (row) => row.name === 'Party_tenant_cpf_unique',
    );

    expect(constraint?.properties).toEqual(['tenant', 'cpf']);
    expect(constraint?.labelsOrTypes).toEqual(['Party']);

    orm.em.create(Party, { tenant: 'acme', cpf: '12345678900' });
    await orm.em.flush();
    orm.em.clear();

    orm.em.create(Party, { tenant: 'acme', cpf: '12345678900' });
    await expect(orm.em.flush()).rejects.toThrow(UniqueConstraintViolationException);
    orm.em.clear();
  });

  test('indexes a relationship entity as an edge', async () => {
    const index = await findIndex('ACTED_IN_billing_idx');

    expect(index?.entityType).toBe('RELATIONSHIP');
    expect(index?.labelsOrTypes).toEqual(['ACTED_IN']);
    expect(index?.properties).toEqual(['billing']);
  });

  test('the composite index actually serves a lookup — seek, not scan', async () => {
    // The only assertion here that proves the index is useful rather than merely present.
    const em = orm.em as Neo4jEntityManager;
    const result = await em
      .getDriver()
      .getConnection('write')
      .executeRaw("EXPLAIN MATCH (n:Document { tenant: 'acme', id: 'x' }) RETURN n", {});

    const plan = JSON.stringify(result.summary.plan);
    expect(plan).toContain('NodeIndexSeek');
    expect(plan).not.toContain('AllNodesScan');
    expect(plan).not.toContain('NodeByLabelScan');
  });

  test('getCreateSchemaSQL() previews the statements without touching the database', async () => {
    const sql = await orm.schema.getCreateSchemaSQL();

    expect(sql).toContain(
      'CREATE RANGE INDEX `Document_tenant_id_idx` IF NOT EXISTS FOR (n:`Document`) ON (n.`tenant`, n.`id`)',
    );
    expect(sql).toContain('CREATE CONSTRAINT `Party_tenant_cpf_unique` IF NOT EXISTS');
    expect(sql).toContain('FOR ()-[r:`ACTED_IN`]-()');
    expect(sql.split(';\n').length).toBeGreaterThan(1);
  });
});
