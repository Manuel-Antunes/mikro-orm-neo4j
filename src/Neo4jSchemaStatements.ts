import type { Dictionary, EntityMetadata } from '@mikro-orm/core';
import crypto from 'node:crypto';
import { Neo4jCypherBuilder } from './Neo4jCypherBuilder.js';

/** Index kinds this generator knows how to emit. */
export type Neo4jIndexKind = 'RANGE' | 'TEXT' | 'POINT' | 'FULLTEXT';

/**
 * Neo4j only allows a single property on TEXT and POINT indexes; RANGE and FULLTEXT accept several.
 */
const SINGLE_PROPERTY_KINDS: ReadonlySet<Neo4jIndexKind> = new Set<Neo4jIndexKind>([
  'TEXT',
  'POINT',
]);

const INDEX_TYPE_MAP: Readonly<Record<string, Neo4jIndexKind>> = {
  range: 'RANGE',
  text: 'TEXT',
  point: 'POINT',
  fulltext: 'FULLTEXT',
  'full-text': 'FULLTEXT',
  fullText: 'FULLTEXT',
};

/** Keeps derived names short enough to stay readable, and stable across runs. */
const MAX_NAME_LENGTH = 63;

/** Shape shared by `meta.indexes[]` and `meta.uniques[]`. */
interface SchemaDefinition {
  properties?: string | string[];
  name?: string;
  type?: string;
  options?: Dictionary;
  expression?: unknown;
  where?: unknown;
  columns?: { name: string }[];
}

export interface CollectSchemaStatementsOptions {
  /** Called when a definition is skipped for having no Neo4j equivalent. */
  onWarning?: (message: string) => void;
}

/**
 * Wraps a token in backticks, escaping any backtick inside it.
 *
 * Mandatory rather than cosmetic: flattened property names contain dots
 * (`address.city`), which unescaped Cypher would read as nested access.
 */
export function escapeToken(token: string): string {
  return `\`${token.replace(/`/g, '``')}\``;
}

/**
 * Builds the name used as the `IF NOT EXISTS` idempotency key, so it must be deterministic.
 * Long names are truncated with a hash suffix, keeping distinct definitions distinct.
 */
export function deriveIndexName(
  label: string,
  properties: string[],
  suffix: 'idx' | 'unique',
): string {
  const raw = `${label}_${properties.join('_')}_${suffix}`;
  const sanitized = raw.replace(/[^A-Za-z0-9_]/g, '_');

  if (sanitized.length <= MAX_NAME_LENGTH) {
    return sanitized;
  }

  const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 8);
  return `${sanitized.slice(0, MAX_NAME_LENGTH - hash.length - 1)}_${hash}`;
}

/** Maps the MikroORM `type` of an index onto a Neo4j index kind. */
export function mapIndexType(type?: string): Neo4jIndexKind {
  if (!type) {
    return 'RANGE';
  }

  const kind = INDEX_TYPE_MAP[type] ?? INDEX_TYPE_MAP[type.toLowerCase()];

  if (kind) {
    return kind;
  }

  if (type.toLowerCase() === 'vector') {
    throw new Error(
      `Vector indexes are not supported by the Neo4j schema generator yet: they require an explicit ` +
        `dimension and similarity function via OPTIONS. Create it with a raw Cypher statement instead.`,
    );
  }

  throw new Error(
    `Unsupported index type '${type}' for Neo4j. Supported types: ${Object.keys(INDEX_TYPE_MAP)
      .filter((key) => key === key.toLowerCase())
      .join(', ')}.`,
  );
}

function asArray(value?: string | string[]): string[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

/**
 * Resolves declared keys to the property names actually written on the node.
 *
 * The Neo4j driver writes node properties by JS key (`prop.name`), never by `fieldNames` as a SQL
 * driver would. Using `fieldNames` here would build an index over a property that does not exist:
 * it would be created successfully, never used, and never noticed.
 */
function resolveProperties(
  meta: EntityMetadata,
  definition: SchemaDefinition,
  context: string,
): string[] {
  const keys = definition.properties
    ? asArray(definition.properties)
    : (definition.columns?.map((column) => column.name) ?? []);

  if (!keys.length) {
    throw new Error(`${context} does not declare any property.`);
  }

  return keys.map((key) => {
    const prop = meta.properties[key as keyof typeof meta.properties];

    if (!prop?.name) {
      throw new Error(
        `${context} references unknown property '${key}'. ` +
          `Known properties: ${Object.keys(meta.properties).join(', ')}.`,
      );
    }

    return prop.name;
  });
}

/**
 * Rejects options that have no Neo4j equivalent, returning false when the definition should be
 * skipped. `where` throws instead of being dropped: emitting a total index in place of a partial
 * one is fine, but emitting a total *constraint* in place of a partial one rejects legitimate
 * rows, and silently degrading a partial index into a total one hides that mismatch either way.
 */
function isSupported(
  definition: SchemaDefinition,
  context: string,
  onWarning: (message: string) => void,
): boolean {
  const where = definition.where ?? definition.options?.where;

  if (where !== undefined) {
    throw new Error(
      `${context} declares a partial (\`where\`) filter, which Neo4j does not support. ` +
        `Creating an unfiltered index or constraint in its place would change its meaning — a ` +
        `partial unique constraint emitted as a total one rejects legitimate rows. ` +
        `Remove the \`where\` option, or model the filtered subset with a dedicated label.`,
    );
  }

  if (definition.expression !== undefined) {
    onWarning(
      `${context} declares an \`expression\` (functional index), which Neo4j does not support. Skipping it.`,
    );
    return false;
  }

  return true;
}

function buildIndexStatement(
  kind: Neo4jIndexKind,
  name: string,
  pattern: string,
  variable: string,
  properties: string[],
  context: string,
): string {
  if (SINGLE_PROPERTY_KINDS.has(kind) && properties.length > 1) {
    throw new Error(
      `${context} declares ${properties.length} properties, but Neo4j ${kind} indexes accept exactly one. ` +
        `Use a RANGE index for composite keys, or a FULLTEXT index to span several properties.`,
    );
  }

  const targets = properties.map((prop) => `${variable}.${escapeToken(prop)}`);

  if (kind === 'FULLTEXT') {
    return `CREATE FULLTEXT INDEX ${escapeToken(name)} IF NOT EXISTS FOR ${pattern} ON EACH [${targets.join(', ')}]`;
  }

  return `CREATE ${kind} INDEX ${escapeToken(name)} IF NOT EXISTS FOR ${pattern} ON (${targets.join(', ')})`;
}

function buildConstraintStatement(name: string, pattern: string, targets: string[]): string {
  return `CREATE CONSTRAINT ${escapeToken(name)} IF NOT EXISTS FOR ${pattern} REQUIRE (${targets.join(', ')}) IS UNIQUE`;
}

const isInterfaceInheritance = (meta: EntityMetadata): boolean =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (meta as any).inheritance === 'interface' || (meta as any).inheritanceType === 'interface';

/**
 * Turns entity metadata into the Cypher statements that materialize its indexes and constraints.
 *
 * Pure by design: `ensureIndexes()` executes what this returns and `getCreateSchemaSQL()` prints it,
 * so the mapping is testable without a database.
 */
export function collectSchemaStatements(
  metadata: EntityMetadata[],
  options: CollectSchemaStatementsOptions = {},
): string[] {
  const onWarning =
    options.onWarning ??
    ((message: string) => {
      // eslint-disable-next-line no-console
      console.warn(`[mikro-orm-neo4j] ${message}`);
    });

  const statements: string[] = [];
  /** Guards against two definitions deriving one name: `IF NOT EXISTS` would silently drop one. */
  const byName = new Map<string, string>();

  const push = (name: string, statement: string, context: string) => {
    const existing = byName.get(name);

    if (existing === statement) {
      return;
    }

    if (existing !== undefined) {
      throw new Error(
        `${context} derives the name '${name}', which is already used by another index or ` +
          `constraint. Neo4j would silently skip one of them. Set an explicit \`name\` on one of the definitions.`,
      );
    }

    byName.set(name, statement);
    statements.push(statement);
  };

  for (const meta of metadata) {
    if (meta.abstract || meta.embeddable || meta.virtual || isInterfaceInheritance(meta)) {
      continue;
    }

    const indexes = (meta.indexes ?? []) as SchemaDefinition[];
    const uniques = (meta.uniques ?? []) as SchemaDefinition[];

    if (!indexes.length && !uniques.length) {
      continue;
    }

    const isRelationship = Neo4jCypherBuilder.isRelationshipEntity(meta);
    // A relationship entity maps to an edge, so its index targets the relationship type.
    const token = isRelationship
      ? Neo4jCypherBuilder.getRelationshipEntityType(meta)
      : // Multi-label entities are indexed on the primary label only: Neo4j indexes per label, and a
        // query matching any secondary label already seeks through the primary one.
        Neo4jCypherBuilder.getNodeLabels(meta)[0];
    const variable = isRelationship ? 'r' : 'n';
    const pattern = isRelationship
      ? `()-[r:${escapeToken(token)}]-()`
      : `(n:${escapeToken(token)})`;

    for (const index of indexes) {
      const context = `Index on ${meta.className}`;

      if (!isSupported(index, context, onWarning)) {
        continue;
      }

      const properties = resolveProperties(meta, index, context);
      const kind = mapIndexType(index.type);
      const name = index.name ?? deriveIndexName(token, properties, 'idx');

      push(name, buildIndexStatement(kind, name, pattern, variable, properties, context), context);
    }

    for (const unique of uniques) {
      const context = `Unique constraint on ${meta.className}`;

      if (!isSupported(unique, context, onWarning)) {
        continue;
      }

      const properties = resolveProperties(meta, unique, context);
      const name = unique.name ?? deriveIndexName(token, properties, 'unique');
      const targets = properties.map((prop) => `${variable}.${escapeToken(prop)}`);

      push(name, buildConstraintStatement(name, pattern, targets), context);
    }
  }

  return statements;
}
