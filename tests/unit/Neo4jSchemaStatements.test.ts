import type { EntityMetadata } from '@mikro-orm/core';
import { describe, expect, test, vi } from 'vitest';
import {
  collectSchemaStatements,
  deriveIndexName,
  escapeToken,
  mapIndexType,
} from '../../src/Neo4jSchemaStatements.js';

type PropertySpec = { name: string; fieldNames?: string[] };

function fakeMeta(overrides: Record<string, unknown> = {}): EntityMetadata {
  const properties = (overrides.properties ?? {}) as Record<string, PropertySpec>;

  return {
    className: 'Person',
    collection: 'Person',
    indexes: [],
    uniques: [],
    ...overrides,
    properties,
  } as unknown as EntityMetadata;
}

/** Builds property metadata whose column name deliberately differs from the JS key. */
function props(...names: string[]): Record<string, PropertySpec> {
  return Object.fromEntries(names.map((name) => [name, { name, fieldNames: [`${name}_column`] }]));
}

describe('escapeToken', () => {
  test('wraps tokens in backticks', () => {
    expect(escapeToken('Person')).toBe('`Person`');
  });

  test('escapes every internal backtick, not just the first', () => {
    expect(escapeToken('a`b`c')).toBe('`a``b``c`');
  });

  test('keeps dotted property names as a single token', () => {
    expect(escapeToken('address.city')).toBe('`address.city`');
  });
});

describe('deriveIndexName', () => {
  test('is deterministic — the name is the IF NOT EXISTS idempotency key', () => {
    expect(deriveIndexName('Person', ['tenant', 'id'], 'idx')).toBe(
      deriveIndexName('Person', ['tenant', 'id'], 'idx'),
    );
  });

  test('sanitizes characters that are not valid in a bare name', () => {
    expect(deriveIndexName('Person', ['address.city'], 'idx')).toBe('Person_address_city_idx');
  });

  test('distinguishes indexes from unique constraints', () => {
    expect(deriveIndexName('Person', ['cpf'], 'unique')).toBe('Person_cpf_unique');
  });

  test('truncates long names while keeping distinct inputs distinct', () => {
    const a = deriveIndexName('L'.repeat(60), ['propertyA'], 'idx');
    const b = deriveIndexName('L'.repeat(60), ['propertyB'], 'idx');

    expect(a.length).toBeLessThanOrEqual(63);
    expect(b.length).toBeLessThanOrEqual(63);
    expect(a).not.toBe(b);
  });
});

describe('mapIndexType', () => {
  test('defaults to RANGE', () => {
    expect(mapIndexType(undefined)).toBe('RANGE');
  });

  test.each([
    ['text', 'TEXT'],
    ['fulltext', 'FULLTEXT'],
    ['point', 'POINT'],
    ['range', 'RANGE'],
  ])('maps %s to %s', (input, expected) => {
    expect(mapIndexType(input)).toBe(expected);
  });

  test('throws on vector indexes instead of emitting an unusable one', () => {
    expect(() => mapIndexType('vector')).toThrow(/Vector indexes are not supported/);
  });

  test('throws on unknown types rather than silently falling back to RANGE', () => {
    expect(() => mapIndexType('gin')).toThrow(/Unsupported index type 'gin'/);
  });
});

describe('collectSchemaStatements', () => {
  test('indexes the JS property name, never the SQL column name', () => {
    // The Neo4j driver writes node properties by prop.name. Indexing fieldNames would create an
    // index over a property that does not exist: created successfully, never used, never noticed.
    const statements = collectSchemaStatements([
      fakeMeta({
        properties: props('plainCamelCase'),
        indexes: [{ properties: ['plainCamelCase'] }],
      }),
    ]);

    expect(statements).toEqual([
      'CREATE RANGE INDEX `Person_plainCamelCase_idx` IF NOT EXISTS FOR (n:`Person`) ON (n.`plainCamelCase`)',
    ]);
    expect(statements[0]).not.toContain('plainCamelCase_column');
  });

  test('preserves composite property order — it decides whether a prefix seek works', () => {
    const statements = collectSchemaStatements([
      fakeMeta({
        properties: props('tenant', 'id'),
        indexes: [{ properties: ['tenant', 'id'] }],
      }),
    ]);

    expect(statements[0]).toContain('ON (n.`tenant`, n.`id`)');
  });

  test('escapes dotted property names so Cypher does not read them as nested access', () => {
    const statements = collectSchemaStatements([
      fakeMeta({
        properties: props('address.city'),
        indexes: [{ properties: ['address.city'] }],
      }),
    ]);

    expect(statements[0]).toContain('ON (n.`address.city`)');
  });

  test('indexes only the primary label of a multi-label entity', () => {
    const statements = collectSchemaStatements([
      fakeMeta({
        collection: 'Person',
        labels: ['Person', 'JudgmentCreditor', 'Party'],
        properties: props('id'),
        indexes: [{ properties: ['id'] }],
      }),
    ]);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('FOR (n:`Person`)');
    expect(statements[0]).not.toContain('JudgmentCreditor');
  });

  test('honours an explicit index name', () => {
    const statements = collectSchemaStatements([
      fakeMeta({
        properties: props('id'),
        indexes: [{ properties: ['id'], name: 'custom_name' }],
      }),
    ]);

    expect(statements[0]).toContain('INDEX `custom_name` IF NOT EXISTS');
  });

  test('emits FULLTEXT with its ON EACH syntax', () => {
    const statements = collectSchemaStatements([
      fakeMeta({
        properties: props('title', 'body'),
        indexes: [{ properties: ['title', 'body'], type: 'fulltext' }],
      }),
    ]);

    expect(statements[0]).toContain('CREATE FULLTEXT INDEX');
    expect(statements[0]).toContain('ON EACH [n.`title`, n.`body`]');
  });

  test('emits a unique constraint', () => {
    const statements = collectSchemaStatements([
      fakeMeta({
        properties: props('tenant', 'cpf'),
        uniques: [{ properties: ['tenant', 'cpf'] }],
      }),
    ]);

    expect(statements).toEqual([
      'CREATE CONSTRAINT `Person_tenant_cpf_unique` IF NOT EXISTS FOR (n:`Person`) REQUIRE (n.`tenant`, n.`cpf`) IS UNIQUE',
    ]);
  });

  test('targets an edge for a relationship entity', () => {
    const statements = collectSchemaStatements([
      fakeMeta({
        className: 'ActedIn',
        collection: 'ActedIn',
        relationship: { type: 'ACTED_IN' },
        properties: props('roles'),
        indexes: [{ properties: ['roles'] }],
      }),
    ]);

    expect(statements[0]).toBe(
      'CREATE RANGE INDEX `ACTED_IN_roles_idx` IF NOT EXISTS FOR ()-[r:`ACTED_IN`]-() ON (r.`roles`)',
    );
  });

  test('skips abstract, embeddable, virtual and interface entities', () => {
    const statements = collectSchemaStatements([
      fakeMeta({ abstract: true, properties: props('id'), indexes: [{ properties: ['id'] }] }),
      fakeMeta({ embeddable: true, properties: props('id'), indexes: [{ properties: ['id'] }] }),
      fakeMeta({ virtual: true, properties: props('id'), indexes: [{ properties: ['id'] }] }),
      fakeMeta({
        inheritance: 'interface',
        properties: props('id'),
        indexes: [{ properties: ['id'] }],
      }),
    ]);

    expect(statements).toEqual([]);
  });

  describe('options with no Neo4j equivalent', () => {
    test('throws on a partial (`where`) unique constraint instead of widening it', () => {
      // Emitting a total unique in place of a partial one rejects legitimate rows: corruption,
      // not degradation. This is the one case where silence produces wrong data.
      expect(() =>
        collectSchemaStatements([
          fakeMeta({
            properties: props('cpf', 'type'),
            uniques: [{ properties: ['cpf'], where: { type: 'JUDGMENT_CREDITOR' } }],
          }),
        ]),
      ).toThrow(/partial \(`where`\) filter/);
    });

    test('throws on a partial index declared through `options.where`', () => {
      expect(() =>
        collectSchemaStatements([
          fakeMeta({
            properties: props('cpf'),
            indexes: [{ properties: ['cpf'], options: { where: 'type = "X"' } }],
          }),
        ]),
      ).toThrow(/partial \(`where`\) filter/);
    });

    test('warns and skips functional (`expression`) indexes', () => {
      const onWarning = vi.fn();
      const statements = collectSchemaStatements(
        [
          fakeMeta({
            properties: props('name'),
            indexes: [{ expression: 'lower(name)' }],
          }),
        ],
        { onWarning },
      );

      expect(statements).toEqual([]);
      expect(onWarning).toHaveBeenCalledWith(expect.stringMatching(/expression/));
    });

    test('ignores SQL-only hints that have no Neo4j meaning', () => {
      const statements = collectSchemaStatements([
        fakeMeta({
          properties: props('id', 'tenant'),
          indexes: [{ properties: ['id'], include: ['tenant'], fillFactor: 70, invisible: true }],
        }),
      ]);

      expect(statements).toHaveLength(1);
    });

    test('throws when a composite TEXT index is declared, which Neo4j cannot build', () => {
      expect(() =>
        collectSchemaStatements([
          fakeMeta({
            properties: props('title', 'body'),
            indexes: [{ properties: ['title', 'body'], type: 'text' }],
          }),
        ]),
      ).toThrow(/accept exactly one/);
    });
  });

  describe('fail-loud guards', () => {
    test('throws on an unknown property rather than indexing nothing', () => {
      expect(() =>
        collectSchemaStatements([
          fakeMeta({ properties: props('id'), indexes: [{ properties: ['nope'] }] }),
        ]),
      ).toThrow(/references unknown property 'nope'/);
    });

    test('throws when two definitions derive one name, which Neo4j would silently skip', () => {
      expect(() =>
        collectSchemaStatements([
          fakeMeta({
            properties: props('id'),
            indexes: [
              { properties: ['id'], name: 'dup' },
              { properties: ['id'], name: 'dup', type: 'text' },
            ],
          }),
        ]),
      ).toThrow(/already used by another index or constraint/);
    });

    test('deduplicates identical statements', () => {
      const statements = collectSchemaStatements([
        fakeMeta({
          properties: props('id'),
          indexes: [{ properties: ['id'] }, { properties: ['id'] }],
        }),
      ]);

      expect(statements).toHaveLength(1);
    });
  });
});
