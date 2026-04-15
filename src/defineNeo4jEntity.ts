import { defineEntity } from '@mikro-orm/core';

// ─── Neo4j custom metadata types ─────────────────────────────────────────────

/**
 * Custom metadata attached to an entity for Neo4j-specific behaviour.
 */
export interface Neo4jEntityCustom {
  /** Additional Neo4j node labels (beyond the collection name). */
  labels?: string[];
  /** Mark this entity as a relationship entity (stored as a Neo4j relationship, not a node). */
  relationshipEntity?: boolean;
  /** Default relationship type for a relationship entity (e.g. 'ACTED_IN'). */
  type?: string;
}

/**
 * Custom metadata attached to a relationship property.
 */
export interface Neo4jPropertyCustom {
  /** Neo4j relationship type string (e.g. 'ACTED_IN', 'BELONGS_TO'). */
  type: string;
  /** Direction of the relationship from this entity's perspective. */
  direction?: 'IN' | 'OUT';
}

// ─── Property helper ─────────────────────────────────────────────────────────

/**
 * Attaches Neo4j relationship metadata to a property builder.
 *
 * Use this inside a `defineEntity` `properties` block
 * to set the relationship type and direction on a ManyToOne, OneToMany, or
 * ManyToMany property.
 *
 * @example
 * ```typescript
 * const BookSchema = defineEntity({
 *   name: 'Book',
 *   properties(p) {
 *     return {
 *       id: p.uuid().primary().onCreate(() => crypto.randomUUID()),
 *       title: p.string(),
 *       author: () => neo4j(
 *         p.manyToOne(AuthorSchema).ref(),
 *         { type: 'WROTE', direction: 'IN' },
 *       ),
 *     };
 *   },
 * });
 * ```
 *
 * @param builder  The property builder returned by p.manyToOne(), p.oneToMany(), etc.
 * @param options  Neo4j relationship options (type, direction).
 * @returns The same builder (with `relation` injected at runtime).
 */
export function neo4j<T>(builder: T, options: Neo4jPropertyCustom): T {
  // At runtime the builder is a UniversalPropertyOptionsBuilder which has
  // `assignOptions`.  The TypeScript types don't expose it on `PropertyChain`,
  // so we access it dynamically.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = builder as any;

  if (typeof b.assignOptions === 'function') {
    return b.assignOptions({ relation: options }) as T;
  }

  // Fallback: mutate the internal options directly
  if (b['~options']) {
    b['~options'].relation = options;
  }

  return builder;
}

// ─── Entity helper ───────────────────────────────────────────────────────────

/**
 * A thin wrapper around MikroORM's `defineEntity` that supports Neo4j-specific
 * options such as `labels`, `relationshipEntity`, and `type` at the entity
 * level.
 *
 * These options are injected into `meta.custom` at runtime so the Neo4j driver
 * can read them during query building and persistence.
 *
 * @example
 * ```typescript
 * const AuthorSchema = defineNeo4jEntity({
 *   name: 'Author',
 *   neo4j: { labels: ['Author', 'Person'] },
 *   properties(p) {
 *     return {
 *       id: p.uuid().primary().onCreate(() => crypto.randomUUID()),
 *       name: p.string(),
 *     };
 *   },
 * });
 * ```
 *
 * @param meta  Standard `defineEntity` metadata plus an optional `neo4j` key.
 * @returns The same EntitySchemaWithMeta returned by `defineEntity`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineNeo4jEntity<T extends Record<string, any>>(
  meta: T & { neo4j?: Neo4jEntityCustom },
) {
  const { neo4j: neo4jOptions, ...rest } = meta;

  // Inject neo4jOptions into the `neo4j` key that MikroORM preserves on
  // EntityMetadata and that the Neo4j driver reads at runtime.
  const entityMeta = rest as Record<string, unknown>;
  if (neo4jOptions) {
    entityMeta.neo4j = neo4jOptions;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return defineEntity(entityMeta as any);
}
