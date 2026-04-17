import {
  defineEntity as originalDefineEntity,
  type EntityCtor,
  type EntityMetadataWithProperties,
  type EntitySchema,
  type InferEntityFromProperties,
} from '@mikro-orm/core';

// ─── Neo4j custom metadata types ─────────────────────────────────────────────

/**
 * Custom metadata attached to an entity for Neo4j-specific behaviour.
 */
export interface Neo4jEntityCustom {
  /** Additional Neo4j node labels (beyond the collection name). */
  labels?: string[];
  /** Mark this entity as a relationship entity or specify default relationship type and direction. */
  relationship?:
    | boolean
    | {
        type?: string;
        direction?: 'IN' | 'OUT';
      };
}

/**
 * Custom metadata attached to a relationship property.
 */
export interface Neo4jPropertyCustom {
  /** Neo4j relationship type string (e.g. 'ACTED_IN', 'BELONGS_TO'). */
  type?: string;
  /** Direction of the relationship from this entity's perspective. */
  direction?: 'IN' | 'OUT';
}

// Module augmentation is now in src/types.d.ts

// Remove EntitySchemaWithMeta as we use augmentation now

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
 * @returns The same builder (with `relationship` injected at runtime).
 */
export function neo4j<T>(builder: T, options: Neo4jPropertyCustom): T {
  // At runtime the builder is a UniversalPropertyOptionsBuilder which has
  // `assignOptions`.  The TypeScript types don't expose it on `PropertyChain`,
  // so we access it dynamically.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = builder as any;

  if (typeof b.assignOptions === 'function') {
    return b.assignOptions({ relationship: options }) as T;
  }

  // Fallback: mutate the internal options directly
  if (b['~options']) {
    b['~options'].relationship = options;
  }

  return builder;
}

// ─── Entity helper ───────────────────────────────────────────────────────────

/**
 * A thin wrapper around MikroORM's `defineEntity` that types Neo4j-specific
 * options such as `labels` and `relationship` at the entity level.
 *
 * @example
 * ```typescript
 * const AuthorSchema = defineNeo4jEntity({
 *   name: 'Author',
 *   labels: ['Author', 'Person'],
 *   properties(p) {
 *     return {
 *       id: p.uuid().primary().onCreate(() => crypto.randomUUID()),
 *       name: p.string(),
 *     };
 *   },
 * });
 * ```
 *
 * @param meta  Standard `defineEntity` metadata.
 * @returns The same EntitySchemaWithMeta returned by `defineEntity`.
 */

export function defineEntity<
  TName extends string,
  TTableName extends string,
  TProperties extends Record<string, any>,
  TPK extends (keyof TProperties)[] | undefined = undefined,
  TBase = never,
  TRepository = never,
  TForceObject extends boolean = false,
>(
  meta: EntityMetadataWithProperties<
    TName,
    TTableName,
    TProperties,
    TPK,
    TBase,
    TRepository,
    TForceObject
  > &
    Neo4jEntityCustom,
): EntitySchema<
  InferEntityFromProperties<TProperties, TPK, TBase, TRepository, TForceObject>,
  TBase,
  EntityCtor<InferEntityFromProperties<TProperties, TPK, TBase, TRepository, TForceObject>>
> {
  const { labels, relationship, ...coreMeta } = meta;
  const schema = originalDefineEntity(coreMeta);
  // Attach Neo4j custom info to the schema's internal meta
  if (labels) {
    schema.meta.labels = labels;
  }
  if (relationship) {
    schema.meta.relationship = relationship;
  }

  return schema;
}
