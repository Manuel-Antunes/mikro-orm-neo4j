import * as Cypher from '@neo4j/cypher-builder';
import {
  type AnyEntity,
  type EntityName,
  type EntityClass,
  type EntityMetadata,
  type FilterQuery,
  type QueryOrderMap,
  ReferenceKind,
  type EntityKey,
  type QueryOrder,
} from '@mikro-orm/core';
import type { Neo4jEntityManager } from './Neo4jEntityManager.js';
import { Neo4jCypherBuilder } from './Neo4jCypherBuilder.js';
import { Neo4jCypherUtils } from './Neo4jCypherUtils.js';

/**
 * Internal helper for methods that can be called on most Cypher clauses.
 * @neo4j/cypher-builder doesn't always expose these on the base Clause class.
 */
type Chainable = Cypher.Clause & {
  where?(predicate: Cypher.Predicate): Chainable;
  return?(...args: unknown[]): Chainable;
  with?(...args: unknown[]): Chainable;
  limit?(value: number | Cypher.Param): Chainable;
  skip?(value: number | Cypher.Param): Chainable;
  orderBy?(...args: unknown[]): Chainable;
  set?(...args: unknown[]): Chainable;
  delete?(...args: unknown[]): Chainable;
  detachDelete?(...args: unknown[]): Chainable;
  concat?(clause: Cypher.Clause): Chainable;
};

export interface QueryBuilderResult<Entity = object> {
  cypher: string;
  params: Record<string, unknown>;
  execute?: () => Promise<Entity[]>;
}

export interface RelationshipOptions {
  direction?: 'left' | 'right' | 'undirected';
  targetLabel?: string;
  targetLabels?: string[];
  /** Target entity class - will extract labels from entity metadata */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  targetEntity?: EntityClass<any>;
  properties?: Record<string, unknown>;
  variable?: Cypher.Relationship;
  /** Alias to use for the target node in the query */
  alias?: string;
  length?: number | { min?: number; max?: number } | '*';
}

export interface CallOptions {
  importVariables?: '*' | (Cypher.Node | Cypher.Variable)[];
  inTransactions?:
    | boolean
    | {
        ofRows?: number;
        concurrentTransactions?: number;
        onError?: 'continue' | 'break' | 'fail';
        retry?: boolean | number;
      };
}

/**
 * Neo4jQueryBuilder provides a fluent API for building Cypher queries programmatically.
 * It wraps Neo4j's official @neo4j/cypher-builder library and integrates with MikroORM's entity system.
 *
 * Supports advanced features:
 * - Complex relationship patterns with properties
 * - Variable-length relationships
 * - CALL subqueries with transaction control
 * - EXISTS and COUNT subqueries
 * - Pattern composition
 * - WITH clause for query chaining
 *
 * @example
 * ```typescript
 * const qb = em.createQueryBuilder<Movie>('Movie');
 * const { cypher, params } = qb
 *   .match()
 *   .where('title', 'The Matrix')
 *   .return(['title', 'released'])
 *   .build();
 *
 * const movies = await qb
 *   .match()
 *   .where('title', 'The Matrix')
 *   .execute();
 * ```
 */
export class Neo4jQueryBuilder<
  Entity extends object = AnyEntity,
  RootAlias extends string = never,
  Hint extends string = never,
  Context extends object = never,
  RawAliases extends string = never,
  Fields extends string = '*',
> {
  private node: Cypher.Node;
  private _pattern?: Cypher.Pattern;
  private clause?: Chainable;
  private labels: string[] = [];
  private readonly meta?: EntityMetadata<Entity>;
  // Store query parts separately for flexible composition
  private clauseType?: 'match' | 'create' | 'merge';
  private wherePredicates: Cypher.Predicate[] = [];
  private returnProperties?: string[] | null;
  private returnMap: Record<string, string> | null = null;
  private returnAlias: string | null = null;
  private orderByOperations: { property: string; direction: 'ASC' | 'DESC' }[] = [];
  private limitValue?: number;
  private skipValue?: number;
  private setOperations: Record<string, unknown> = {};
  private deleteOperation?: { detach: boolean };
  private readonly variables = new Map<string, Cypher.Variable>();

  constructor(
    private readonly entityName?: EntityName<Entity>,
    private readonly em?: Neo4jEntityManager,
    private readonly alias?: string,
  ) {
    // Extract labels from entity name if provided
    if (this.entityName && this.em) {
      this.meta = this.em.getMetadata().find(this.entityName as EntityName<Entity>);
      if (this.meta) {
        // Use getNodeLabels which reads collection + custom.labels
        this.labels = Neo4jCypherBuilder.getNodeLabels(this.meta);
      }
    }

    // Fallback when no EM or meta is available, or meta lookup failed
    if (this.labels.length === 0 && this.entityName) {
      // Handle schema objects or classes/strings
      let labelString: string | undefined;

      if (typeof this.entityName === 'string') {
        labelString = this.entityName;
      } else if (typeof this.entityName === 'function') {
        labelString = this.entityName.name;
      } else if (typeof this.entityName === 'object' && this.entityName !== null) {
        // Handle EntitySchema or other descriptors
        labelString =
          (this.entityName as { name?: string }).name ||
          (this.entityName as { className?: string }).className;
      }

      if (labelString) {
        // MikroORM defaults to lowercased entity names as labels/collection names
        this.labels = [labelString.toLowerCase()];
      }
    }

    if (this.alias) {
      this.node = new Cypher.NamedNode(this.alias);
      this.variables.set(this.alias, this.node);
    } else {
      this.node = new Cypher.Node();
    }
  }

  /**
   * Creates a MATCH clause to find nodes in the graph.
   *
   * @example
   * ```typescript
   * qb.match() // MATCH (this0:Movie)
   * ```
   */
  match(): this {
    this.clauseType = 'match';
    this.clause = new Cypher.Match(
      new Cypher.Pattern(this.node, { labels: this.labels }),
    ) as unknown as Chainable;
    return this;
  }

  /**
   * Sets the fields to be returned by the query.
   * Alias for return() in Neo4jQueryBuilder but with standard MikroORM signature.
   */
  select<F extends string = Fields, TRoot extends string = RootAlias>(
    fields: F | F[] | Record<string, string>,
    alias?: TRoot,
  ): Neo4jQueryBuilder<Entity, TRoot, Hint, Context, RawAliases, F> {
    if (Array.isArray(fields)) {
      this.returnProperties = fields as string[];
    } else if (typeof fields === 'object' && fields !== null) {
      this.returnMap = fields as Record<string, string>;
    } else if (typeof fields === 'string' && fields !== '*') {
      this.returnProperties = [fields];
    } else if (fields === '*') {
      this.returnProperties = null; // null means RETURN node (the whole thing)
    }

    if (alias) {
      this.returnAlias = alias as string;
    }

    return this as unknown as Neo4jQueryBuilder<Entity, TRoot, Hint, Context, RawAliases, F>;
  }

  /**
   * Sets the root entity and alias for the query.
   * Shortcut for match() with alias.
   */
  from<TRoot extends string = RootAlias>(
    entityName: EntityName<Entity>,
    alias?: TRoot,
  ): Neo4jQueryBuilder<Entity, TRoot, Hint, Context, RawAliases, Fields> {
    this.match();
    if (alias) {
      // In Cypher builder, labels are applied to the node, and the node is used in patterns.
      // We already created the node in match().
      this.variables.set(alias, this.node);
    }
    return this as unknown as Neo4jQueryBuilder<Entity, TRoot, Hint, Context, RawAliases, Fields>;
  }

  create(properties?: Record<string, unknown>): this {
    this.clauseType = 'create';
    const nodeOptions: {
      labels: string[];
      properties?: Record<string, Cypher.Param>;
    } = {
      labels: this.labels,
    };
    if (properties) {
      nodeOptions.properties = this.convertPropertiesToParams(properties);
    }
    this._pattern = new Cypher.Pattern(this.node, nodeOptions);
    this.clause = new Cypher.Create(this._pattern) as unknown as Chainable;
    return this;
  }

  /**
   * Creates a MERGE clause to ensure a node exists (create if it doesn't).
   *
   * @param properties - Optional properties for the node
   * @example
   * ```typescript
   * qb.merge({ title: 'The Matrix' })
   * ```
   */
  merge(properties?: Record<string, unknown>): this {
    this.clauseType = 'merge';
    const nodeOptions: { labels: string[]; properties?: Record<string, Cypher.Param> } = {
      labels: this.labels,
    };
    if (properties) {
      nodeOptions.properties = this.convertPropertiesToParams(properties);
    }
    this._pattern = new Cypher.Pattern(this.node, nodeOptions);
    this.clause = new Cypher.Merge(this._pattern) as unknown as Chainable;
    return this;
  }

  /**
   * Adds WHERE conditions to the query.
   * Supports both simple property-value pairs and complex FilterQuery objects.
   */
  where(where: FilterQuery<Entity>): this;
  where<K extends EntityKey<Entity>>(property: K | string, value: unknown): this;
  where(predicate: Cypher.Predicate): this;
  where(
    propertyOrPredicate: string | FilterQuery<Entity> | Cypher.Predicate,
    value?: unknown,
  ): this {
    if (!this.clauseType) {
      throw new Error('Cannot add WHERE clause without a MATCH, CREATE, or MERGE clause');
    }

    const isPlainObject = (obj: unknown): obj is Record<string, unknown> =>
      obj !== null &&
      typeof obj === 'object' &&
      Object.prototype.toString.call(obj) === '[object Object]' &&
      Object.getPrototypeOf(obj) === Object.prototype;

    if (isPlainObject(propertyOrPredicate)) {
      // It's a FilterQuery
      return this.whereFilter(propertyOrPredicate as FilterQuery<Entity>);
    }

    if (typeof propertyOrPredicate === 'string') {
      const prop = this.resolvePropertyPath(propertyOrPredicate);
      if (value !== undefined) {
        this.wherePredicates.push(Cypher.eq(prop, new Cypher.Param(value)));
      } else {
        // Simple property existence check: WHERE node.prop IS NOT NULL
        this.wherePredicates.push(Cypher.isNotNull(prop));
      }
    } else if (
      propertyOrPredicate instanceof Cypher.Variable ||
      (propertyOrPredicate as Cypher.Predicate).getCypher
    ) {
      // It's a Cypher Predicate or Variable that can act as one
      this.wherePredicates.push(propertyOrPredicate as Cypher.Predicate);
    }

    return this;
  }

  /**
   * Adds a JOIN (MATCH pattern) to the query.
   */
  join<K extends string = never>(
    property: K,
    alias: string,
    type: 'left' | 'inner' = 'inner',
  ): this {
    const direction = type === 'left' ? 'undirected' : 'right'; // Default to 'right' for inner join if not specified
    // Cast property to string as related() handles both strings and classes
    return this.related(property as string, { alias, direction });
  }

  innerJoin<K extends string = never>(property: K, alias: string): this {
    return this.join(property, alias, 'inner');
  }

  leftJoin<K extends string = never>(property: K, alias: string): this {
    return this.join(property, alias, 'left');
  }

  /**
   * Alias for andWhere()
   */
  and<K extends EntityKey<Entity>>(property: K | string, value: unknown): this;
  and(propertyOrPredicate: string | FilterQuery<Entity>, value?: unknown): this {
    return this.andWhere(propertyOrPredicate as string, value);
  }

  /**
   * Adds an AND condition to the WHERE clause using MikroORM-style FilterQuery.
   */
  andWhere(where: FilterQuery<Entity>): this;
  andWhere<K extends EntityKey<Entity>>(property: K | string, value: unknown): this;
  andWhere(propertyOrPredicate: string | FilterQuery<Entity>, value?: unknown): this {
    return this.where(propertyOrPredicate as string, value);
  }

  /**
   * Alias for orWhere()
   */
  or(where: FilterQuery<Entity>): this;
  or<K extends EntityKey<Entity>>(property: K | string, value: unknown): this;
  or(propertyOrPredicate: string | FilterQuery<Entity>, value?: unknown): this {
    return this.orWhere(propertyOrPredicate as string, value);
  }

  orWhere(where: FilterQuery<Entity>): this;
  orWhere<K extends EntityKey<Entity>>(property: K | string, value: unknown): this;
  orWhere(propertyOrPredicate: string | FilterQuery<Entity>, value?: unknown): this {
    if (this.wherePredicates.length > 0) {
      const last = this.wherePredicates.pop()!;
      let current: Cypher.Predicate;

      const isPlainObject = (obj: unknown): obj is Record<string, unknown> =>
        obj !== null &&
        typeof obj === 'object' &&
        Object.prototype.toString.call(obj) === '[object Object]' &&
        Object.getPrototypeOf(obj) === Object.prototype;

      if (typeof propertyOrPredicate === 'string') {
        const prop = this.resolvePropertyPath(propertyOrPredicate);
        current = Cypher.eq(prop, new Cypher.Param(value));
      } else if (isPlainObject(propertyOrPredicate)) {
        const clauses = Neo4jCypherUtils.buildWhereClauses(
          this.node,
          propertyOrPredicate as FilterQuery<Entity>,
        );
        if (clauses.length === 0) {
          this.wherePredicates.push(last);
          return this;
        }

        const predicate = clauses.length > 1 ? Cypher.and(...clauses) : clauses[0];
        if (!predicate) {
          this.wherePredicates.push(last);
          return this;
        }
        current = predicate;
      } else {
        // Safe cast for Cypher Predicate
        current = propertyOrPredicate as unknown as Cypher.Predicate;
      }

      this.wherePredicates.push(Cypher.or(last, current));
    } else {
      this.where(propertyOrPredicate as unknown as Cypher.Predicate);
    }
    return this;
  }

  /**
   * Adds WHERE conditions using MikroORM-style FilterQuery syntax.
   */
  whereFilter(filter: FilterQuery<Entity>): this {
    const isPlainObject = (obj: unknown): obj is Record<string, unknown> =>
      obj !== null &&
      typeof obj === 'object' &&
      Object.prototype.toString.call(obj) === '[object Object]' &&
      Object.getPrototypeOf(obj) === Object.prototype;

    if (!isPlainObject(filter)) {
      // If it's a Cypher predicate, use it
      if ((filter as any).getCypher) {
        this.wherePredicates.push(filter as unknown as Cypher.Predicate);
      }
      return this;
    }

    const clauses = Neo4jCypherUtils.buildWhereClauses(this.node, filter as FilterQuery<Entity>);
    if (clauses.length > 0) {
      const predicate = Cypher.and(...clauses);
      if (predicate) {
        this.wherePredicates.push(predicate);
      }
    }
    return this;
  }

  /**
   * Adds a RETURN clause to specify what to return.
   * Can be called in any order - will be applied correctly during build().
   *
   * @param properties - Property names to return, or node itself if empty
   * @example
   * ```typescript
   * qb.match().return(['title', 'released'])
   * qb.match().return() // returns the entire node
   * ```
   */
  return<F extends string = Fields>(
    properties?: F | F[] | EntityKey<Entity>[] | (string & {})[] | Record<string, string> | null,
    alias?: string,
  ): Neo4jQueryBuilder<Entity, RootAlias, Hint, Context, RawAliases, F> {
    if (!this.clauseType) {
      throw new Error('Cannot add RETURN clause without a query clause');
    }

    if (properties) {
      if (typeof properties === 'string') {
        this.returnProperties = [properties];
        this.returnMap = null;
      } else if (Array.isArray(properties)) {
        this.returnProperties = properties as string[];
        this.returnMap = null;
      } else {
        this.returnProperties = null;
        this.returnMap = properties as Record<string, string>;
      }
    } else {
      this.returnProperties = null;
      this.returnMap = null;
    }

    if (alias) {
      this.returnAlias = alias;
    }

    return this as unknown as Neo4jQueryBuilder<Entity, RootAlias, Hint, Context, RawAliases, F>;
  }

  /**
   * Aliases the entire return clause.
   * Useful for virtual entities which expect the result to be under a specific key (e.g., 'node').
   *
   * @param alias - The alias name
   * @example
   * ```typescript
   * qb.match().return({ name: 'n.name' }).as('node')
   * // Matches: RETURN { name: n.name } AS node
   * ```
   */
  as(alias: string): this {
    this.returnAlias = alias;
    return this;
  }

  /**
   * Adds sorting to the query result.
   */
  orderBy(
    property: EntityKey<Entity> | string | QueryOrderMap<Entity> | QueryOrderMap<Entity>[],
    direction: QueryOrder | 'ASC' | 'DESC' | (string & {}) = 'ASC',
  ): this {
    if (typeof property === 'string') {
      this.orderByOperations.push({
        property,
        direction: (String(direction).toUpperCase() === 'DESC' ? 'DESC' : 'ASC') as 'ASC' | 'DESC',
      });
    } else {
      const orders = Array.isArray(property) ? property : [property];
      orders.forEach((order) => {
        Object.entries(order).forEach(([prop, dir]) => {
          this.orderByOperations.push({
            property: prop,
            direction: (String(dir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC') as 'ASC' | 'DESC',
          });
        });
      });
    }
    return this;
  }

  /**
   * Adds additional sorting to the query result.
   */
  andOrderBy(
    property: EntityKey<Entity> | string | QueryOrderMap<Entity> | QueryOrderMap<Entity>[],
    direction: QueryOrder | 'ASC' | 'DESC' | (string & {}) = 'ASC',
  ): this {
    return this.orderBy(property, direction);
  }

  /**
   * Limits the number of results returned.
   */
  limit(value: number): this {
    this.limitValue = value;
    return this;
  }

  /**
   * Skips a specified number of results.
   */
  offset(value: number): this {
    this.skipValue = value;
    return this;
  }

  skip(value: number): this {
    return this.offset(value);
  }

  /**
   * Adds a DELETE clause to delete nodes or relationships.
   * Can be called in any order - will be applied correctly during build().
   *
   * @param detach - Whether to detach relationships before deleting (default: true)
   * @example
   * ```typescript
   * qb.match().where('title', 'OldMovie').delete()
   * ```
   */
  delete(detach = true): this {
    if (!this.clauseType) {
      throw new Error('Cannot add DELETE clause without a query clause');
    }

    this.deleteOperation = { detach };
    return this;
  }

  /**
   * Adds a SET clause to update node properties.
   * Can be called in any order - will be applied correctly during build().
   *
   * @param properties - Properties to set
   * @example
   * ```typescript
   * qb.match().where('title', 'The Matrix').set({ tagline: 'Welcome to the Real World' })
   * ```
   */
  set(properties: Record<string, unknown>): this {
    if (!this.clauseType) {
      throw new Error('Cannot add SET clause without a query clause');
    }

    // Store SET operations to apply during build
    Object.assign(this.setOperations, properties);
    return this;
  }

  /**
   * Creates a relationship pattern for matching or creating relationships.
   * Supports advanced features like properties, variable length, and custom variables.
   *
   * @param relationshipTypeOrProperty - The relationship type string (e.g., 'ACTED_IN'), property name when using entity-based approach, or relationship entity class (e.g., FriendsWith)
   * @param optionsOrDirection - Configuration options object or legacy direction string
   * @param targetLabelOrEntity - (Legacy) Target node label when using old signature, or target entity class
   * @param relationshipAlias - (Legacy) Relationship alias when using old signature
   * @example
   * ```typescript
   * // Using relationship entity class (extracts type and target from @RelationshipProperties)
   * qb.match().related(FriendsWith) // Uses metadata from relationship entity
   * qb.match().related(FriendsWith, { direction: 'right', properties: { since: 2020 } })
   *
   * // Entity-based (extracts metadata from decorators)
   * qb.match().related(Movie, 'actors') // Uses @Rel/@RelMany metadata
   *
   * // With entity class in options
   * qb.match().related('ACTED_IN', { targetEntity: Person, direction: 'left' })
   *
   * // Traditional - Basic relationship
   * qb.match().related('ACTED_IN', { direction: 'left', targetLabel: 'Person' })
   *
   * // Legacy signature
   * qb.match().related('ACTED_IN', 'left', 'Person', 'p')
   *
   * // With properties
   * qb.match().related('ACTED_IN', {
   *   direction: 'left',
   *   targetLabel: 'Person',
   *   properties: { since: 2020 }
   * })
   * @param targetLabelOrEntity - Target node label or entity class to resolve labels
   * @param alias - Optional alias for the target node (legacy)
   */
  related(
    relationshipTypeOrProperty: EntityName<AnyEntity> | string,
    optionsOrDirection?: RelationshipOptions | 'left' | 'right' | 'undirected',
    targetLabelOrEntity?: EntityName<AnyEntity>,
    alias?: string,
  ): this {
    if (!this._pattern) {
      this._pattern = new Cypher.Pattern(this.node, { labels: this.labels });
    }

    let relationshipType: string;
    let opts: RelationshipOptions;

    // Normalize defineEntity schema objects: { class: Constructor, meta: ... } → class constructor
    const schema =
      relationshipTypeOrProperty &&
      typeof relationshipTypeOrProperty === 'object' &&
      'class' in relationshipTypeOrProperty
        ? (relationshipTypeOrProperty as any)
        : null;

    if (schema) {
      relationshipTypeOrProperty = (schema as any).class || schema;
    }

    // Normalize targetLabelOrEntity if it's a schema
    if (
      typeof targetLabelOrEntity === 'object' &&
      targetLabelOrEntity !== null &&
      'class' in targetLabelOrEntity
    ) {
      targetLabelOrEntity = (targetLabelOrEntity as any).class as EntityClass<AnyEntity>;
    }

    // ─── Resolve relationship type and options ───────────────────────────────
    // We support several signatures:
    // 1. related(RelationshipEntityClass, options)
    // 2. related(NodeEntityClass, propertyName, targetLabel?, alias?)
    // 3. related(type, direction, targetLabel?, alias?)
    // 4. related(type, { options })

    if (
      typeof relationshipTypeOrProperty === 'function' &&
      this.em &&
      Neo4jCypherBuilder.isRelationshipEntity(
        this.em.getMetadata().find(relationshipTypeOrProperty as EntityName<AnyEntity>)!,
      )
    ) {
      // 1. Handle relationship entity class: related(FriendsWith, options)
      const relMeta = this.em
        .getMetadata()
        .find(relationshipTypeOrProperty as EntityName<AnyEntity>)!;
      relationshipType = Neo4jCypherBuilder.getRelationshipEntityType(relMeta);

      // Extract target entity from relationship entity's @ManyToOne properties
      const [, targetProp] = Neo4jCypherBuilder.getRelationshipEntityEnds(relMeta);

      const options = typeof optionsOrDirection === 'object' ? optionsOrDirection : {};
      opts = {
        direction: options.direction || 'right',
        targetEntity:
          options.targetEntity || (targetProp.targetMeta?.class as EntityClass<AnyEntity>),
        properties: options.properties,
        length: options.length,
        variable: options.variable,
      };
    } else if (typeof relationshipTypeOrProperty === 'function') {
      // 2. Handle node entity with property: related(Movie, 'actors')
      const sourceEntity = relationshipTypeOrProperty;
      const propertyName = optionsOrDirection as string;

      let relType: string | undefined;
      let cypherDirection: 'left' | 'right' | undefined;

      if (this.em) {
        const sourceMeta = this.em.getMetadata().find(sourceEntity as EntityName<AnyEntity>);
        const prop = sourceMeta?.properties[propertyName as EntityKey<AnyEntity>];
        if (prop) {
          const propCustom = (
            prop as {
              relationship?: { type?: string; relType?: string; direction?: 'IN' | 'OUT' };
            }
          ).relationship;
          if (propCustom?.type) {
            relType = propCustom.type;
          } else if (propCustom?.relType) {
            relType = propCustom.relType;
          }
          if (propCustom?.direction) {
            cypherDirection = propCustom.direction === 'IN' ? 'left' : 'right';
          }
        }
      }

      if (!relType) {
        relType = Neo4jCypherBuilder.getRelationshipType(sourceEntity, propertyName, false);
      }

      if (!relType) {
        throw new Error(
          `No relationship metadata found on ${(sourceEntity as EntityClass<AnyEntity>).name}.${propertyName}. ` +
            `Please use 'relationship: { type, direction }' in your decorator options.`,
        );
      }
      relationshipType = relType;

      let targetEntity: EntityClass<AnyEntity> | undefined;
      if (this.em && typeof targetLabelOrEntity !== 'string') {
        const meta = this.em.getMetadata().find(sourceEntity as EntityName<AnyEntity>);
        const prop = meta?.properties[propertyName as EntityKey<AnyEntity>];
        if (prop?.targetMeta) {
          targetEntity = prop.targetMeta.class as EntityClass<AnyEntity>;
        }
      }

      opts = {
        direction: cypherDirection,
        targetEntity:
          targetLabelOrEntity && typeof targetLabelOrEntity !== 'string'
            ? (targetLabelOrEntity as EntityClass<AnyEntity>)
            : (targetEntity as EntityClass<AnyEntity>),
      };
    } else if (
      typeof optionsOrDirection === 'string' &&
      (optionsOrDirection === 'left' ||
        optionsOrDirection === 'right' ||
        optionsOrDirection === 'undirected')
    ) {
      // 3. Handle legacy signature: related(type, direction, targetLabel, alias)
      relationshipType = relationshipTypeOrProperty as string;
      opts = {
        direction: optionsOrDirection as RelationshipOptions['direction'],
        targetLabel: typeof targetLabelOrEntity === 'string' ? targetLabelOrEntity : undefined,
        targetEntity:
          targetLabelOrEntity && typeof targetLabelOrEntity !== 'string'
            ? (targetLabelOrEntity as EntityClass<AnyEntity>)
            : undefined,
        alias: alias,
      };
    } else {
      // 4. Handle new signature: related('ACTED_IN', { options })
      relationshipType = relationshipTypeOrProperty as string;
      opts = (optionsOrDirection as RelationshipOptions) || {};
    }

    const direction = opts.direction || 'right';

    const relationship = opts.variable || new Cypher.Relationship();
    const relationshipOptions: {
      type: string;
      direction: 'left' | 'right' | 'undirected';
      properties?: Record<string, Cypher.Param>;
      length?: number | '*' | { min: number; max?: number };
    } = {
      type: relationshipType,
      direction: direction as 'left' | 'right' | 'undirected',
    };

    if (opts.properties) {
      relationshipOptions.properties = this.convertPropertiesToParams(opts.properties);
    }

    if (opts.length !== undefined) {
      relationshipOptions.length = opts.length as number | '*' | { min: number; max?: number };
    }

    // Extract target labels
    let targetLabels: string[] | undefined;

    // Use explicit targetLabels if provided
    if (opts.targetLabels) {
      targetLabels = opts.targetLabels;
    } else {
      // Try to resolve from targetEntity (class or name) or targetLabel string
      const entityToResolve = opts.targetEntity || opts.targetLabel;

      if (entityToResolve) {
        if (this.em) {
          const meta = this.em.getMetadata().find(entityToResolve as EntityName<AnyEntity>);
          if (meta) {
            targetLabels = Neo4jCypherBuilder.getNodeLabels(meta);
          }
        }

        // Fallback for string-based entities or raw labels
        if (!targetLabels && typeof entityToResolve === 'string') {
          targetLabels = [entityToResolve];
        } else if (!targetLabels && typeof entityToResolve === 'function') {
          targetLabels = [(entityToResolve as EntityClass<AnyEntity>).name];
        }
      }
    }

    const targetNode = opts.alias ? new Cypher.NamedNode(opts.alias) : new Cypher.Node();

    this._pattern = this._pattern
      .related(relationship, relationshipOptions)
      .to(targetNode, targetLabels ? { labels: targetLabels } : undefined);

    if (opts.alias) {
      this.variables.set(opts.alias, targetNode);
    }

    // Rebuild the clause with the new pattern
    if (this.clauseType === 'match') {
      this.clause = new Cypher.Match(this._pattern);
    } else if (this.clauseType === 'create') {
      this.clause = new Cypher.Create(this._pattern);
    } else if (this.clauseType === 'merge') {
      this.clause = new Cypher.Merge(this._pattern);
    }

    return this;
  }

  /**
   * Creates a pattern with explicit control over nodes and relationships.
   * Use this for complex patterns with multiple steps or custom node/relationship variables.
   *
   * @param callback - Function that receives Cypher builder and current node, returns Pattern
   * @example
   * ```typescript
   * qb.match().pattern((Cypher, node) => {
   *   const person = new Cypher.Node();
   *   const actedIn = new Cypher.Relationship();
   *   return new Cypher.Pattern(node, { labels: ['Movie'] })
   *     .related(actedIn, { type: 'ACTED_IN', direction: 'left' })
   *     .to(person, { labels: ['Person'] });
   * })
   * ```
   */
  pattern(callback: (cypher: typeof Cypher, node: Cypher.Node) => Cypher.Pattern): this {
    if (!this.clauseType) {
      throw new Error('pattern() must be called after match(), create(), or merge()');
    }

    this._pattern = callback(Cypher, this.node);

    // Update the clause with the new pattern
    if (this.clauseType === 'match') {
      this.clause = new Cypher.Match(this._pattern);
    } else if (this.clauseType === 'create') {
      this.clause = new Cypher.Create(this._pattern);
    } else if (this.clauseType === 'merge') {
      this.clause = new Cypher.Merge(this._pattern);
    }

    return this;
  }

  /**
   * Adds a WITH clause to pass variables between query parts.
   * Used for query chaining and complex multi-part queries.
   *
   * @param variables - Variables or expressions to pass forward
   * @example
   * ```typescript
   * const node = qb.getNode();
   * qb.match()
   *   .where('title', 'The Matrix')
   *   .with([node.property('title'), 'movieTitle'])
   *   .return(['movieTitle'])
   * ```
   */
  with(variables: (string | Cypher.Property | [any, string])[]): this {
    if (!this.clause) {
      throw new Error('with() must be called after a clause');
    }

    const withItems: any[] = [];
    for (const v of variables) {
      if (Array.isArray(v)) {
        withItems.push(v); // [expression, alias]
      } else if (typeof v === 'string') {
        // If it's a property name, get it from the node
        withItems.push(this.node.property(v));
      } else {
        withItems.push(v);
      }
    }

    if (this.clause && typeof this.clause.with === 'function') {
      this.clause = this.clause.with(...withItems);
    }
    return this;
  }

  /**
   * Creates a CALL subquery for executing subqueries.
   * Supports transaction control, variable import, and chaining.
   *
   * @param subquery - The subquery to execute (QueryBuilder or Cypher clause)
   * @param options - Subquery options (import variables, transaction settings)
   * @example
   * ```typescript
   * // Basic subquery
   * const subQb = em.createQueryBuilder<Person>('Person')
   *   .match()
   *   .where('age', 25)
   *   .return(['name']);
   *
   * qb.call(subQb)
   *   .return(['name'])
   *
   * // With imported variables
   * qb.call(subQb, { importVariables: '*' })
   *
   * // With transaction control
   * qb.call(subQb, {
   *   inTransactions: {
   *     ofRows: 1000,
   *     concurrentTransactions: 4,
   *     onError: 'continue'
   *   }
   * })
   * ```
   */
  call(subquery: Neo4jQueryBuilder<any> | any, options?: CallOptions): this {
    const opts = options || {};

    let subClause: Cypher.Clause;
    if (subquery instanceof Neo4jQueryBuilder) {
      // Build the subquery to get its clause
      subquery.build(); // This builds and stores the clause
      subClause = subquery.clause as Cypher.Clause;
    } else {
      subClause = subquery as Cypher.Clause;
    }

    const importVars = opts.importVariables;
    let callClause: any;

    if (importVars) {
      callClause = new Cypher.Call(subClause, importVars);
    } else {
      callClause = new Cypher.Call(subClause);
    }

    // Handle inTransactions option
    if (opts.inTransactions) {
      if (typeof opts.inTransactions === 'boolean') {
        callClause = callClause.inTransactions();
      } else {
        callClause = callClause.inTransactions(opts.inTransactions);
      }
    }

    if (this.clause && typeof this.clause.concat === 'function') {
      // Chain with existing clause
      this.clause = this.clause.concat(callClause);
    } else {
      this.clause = callClause;
      this.clauseType = 'match'; // Set a type so other methods work
    }

    return this;
  }

  /**
   * Creates an EXISTS subquery predicate for checking pattern existence.
   * Returns a predicate that can be used in WHERE clauses.
   *
   * @param pattern - The pattern or query to check for existence
   * @returns Cypher EXISTS predicate
   * @example
   * ```typescript
   * const Cypher = qb.getCypher();
   * const actorNode = qb.getNode();
   *
   * // Check if actor has acted in any movie
   * const existsPattern = new Cypher.Pattern(actorNode)
   *   .related(new Cypher.Relationship({ type: 'ACTED_IN' }))
   *   .to(new Cypher.Node({ labels: ['Movie'] }));
   *
   * qb.match()
   *   .where(qb.exists(existsPattern))
   *   .return(['name'])
   * ```
   */
  exists(pattern: Cypher.Pattern): Cypher.Predicate {
    return new Cypher.Exists(pattern);
  }

  /**
   * Creates a COUNT subquery for counting matching patterns.
   *
   * @param pattern - The pattern to count
   * @returns Cypher COUNT expression
   * @example
   * ```typescript
   * const Cypher = qb.getCypher();
   * const actorNode = qb.getNode();
   *
   * // Count movies an actor has been in
   * const countPattern = new Cypher.Pattern(actorNode)
   *   .related(new Cypher.Relationship({ type: 'ACTED_IN' }))
   *   .to(new Cypher.Node({ labels: ['Movie'] }));
   *
   * const count = qb.count(countPattern);
   * qb.match().where(Cypher.gt(count, new Cypher.Param(5)))
   * ```
   */
  count(pattern: any): Cypher.Count {
    return new Cypher.Count(pattern);
  }

  /**
   * Access the underlying Cypher node for advanced operations.
   * Useful for building custom predicates and expressions.
   *
   * @example
   * ```typescript
   * const node = qb.getNode();
   * const titleProp = node.property('title');
   * qb.match().where(Cypher.contains(titleProp, new Cypher.Param('Matrix')))
   * ```
   */
  getNode(): Cypher.Node {
    return this.node;
  }

  /**
   * Access the raw Cypher builder for advanced usage.
   * Provides access to all Cypher builder classes and functions.
   *
   * @example
   * ```typescript
   * const Cypher = qb.getCypher();
   * const customPattern = new Cypher.Pattern(node)...
   * ```
   */
  getCypher() {
    return Cypher;
  }

  /**
   * Builds the Cypher query and returns the query string and parameters.
   * Assembles all query parts in the correct order regardless of call order.
   *
   * @returns Object with cypher string, params object, and optional execute function
   * @example
   * ```typescript
   * const { cypher, params } = qb.match().where('title', 'The Matrix').build();
   * console.log(cypher); // MATCH (this0:Movie) WHERE this0.title = $param0 RETURN this0
   * console.log(params); // { param0: 'The Matrix' }
   * ```
   */
  build(): QueryBuilderResult<Entity> {
    if (!this.clauseType) {
      throw new Error('Cannot build query without any clauses');
    }

    // Start with the base clause (MATCH, CREATE, or MERGE)
    if (!this.clause) {
      throw new Error('Base clause is undefined');
    }

    // Using any for assembly to avoid fighting with optional methods on re-assigned variables.
    // The previous checks ensure the logic is safe.
    let clause: any = this.clause;

    // Apply WHERE predicates if any
    if (this.wherePredicates.length > 0) {
      let combinedPredicate = this.wherePredicates[0] as unknown as Cypher.Predicate;
      for (let i = 1; i < this.wherePredicates.length; i++) {
        combinedPredicate = Cypher.and(
          combinedPredicate,
          this.wherePredicates[i] as unknown as Cypher.Predicate,
        );
      }
      if (clause.where) {
        clause = clause.where(combinedPredicate);
      }
    }

    // Apply SET operations if any
    if (Object.keys(this.setOperations).length > 0) {
      for (const [key, value] of Object.entries(this.setOperations)) {
        const prop = this.node.property(key);
        if (clause.set) {
          clause = clause.set([prop, new Cypher.Param(value)]);
        }
      }
    }

    // Apply DELETE if specified
    if (this.deleteOperation) {
      if (this.deleteOperation.detach && clause.detachDelete) {
        clause = clause.detachDelete(this.node);
      } else if (clause.delete) {
        clause = clause.delete(this.node);
      }
    }

    if (this.returnMap !== null) {
      const mapObj: Record<string, Cypher.Expr> = {};
      for (const [key, value] of Object.entries(this.returnMap)) {
        mapObj[key] = this.resolvePropertyPath(value);
      }
      const mapExpr = new Cypher.Map(mapObj);
      const returnArg = this.returnAlias ? [mapExpr, this.returnAlias] : mapExpr;
      if (clause.return) {
        clause = clause.return(returnArg);
      }
    } else if (this.returnProperties !== undefined) {
      if (clause.return) {
        if (this.returnProperties === null) {
          const returnArg = this.returnAlias ? [this.node, this.returnAlias] : this.node;
          clause = clause.return(returnArg);
        } else {
          const returnExpressions = this.returnProperties.map((prop) => [
            this.node.property(prop),
            prop as any,
          ]);
          clause = clause.return(...returnExpressions);
        }
      }
    } else if (this.clauseType === 'match') {
      // If no explicit RETURN, add default RETURN for read queries
      if (clause.return) {
        const returnArg = this.returnAlias ? [this.node, this.returnAlias] : this.node;
        clause = clause.return(returnArg);
      }
    }

    // Apply ORDER BY clauses
    if (this.orderByOperations.length > 0 && clause.orderBy) {
      for (const { property, direction } of this.orderByOperations) {
        const prop = this.resolvePropertyPath(property);
        const sortItem =
          direction === 'DESC'
            ? ([prop, 'DESC'] as [unknown, 'DESC'])
            : ([prop, 'ASC'] as [unknown, 'ASC']);
        clause = clause.orderBy(sortItem);
      }
    }

    // Apply SKIP
    if (this.skipValue !== undefined && clause.skip) {
      clause = clause.skip(this.skipValue);
    }

    // Apply LIMIT
    if (this.limitValue !== undefined && clause.limit) {
      clause = clause.limit(this.limitValue);
    }

    const { cypher, params } = clause.build();

    const result: QueryBuilderResult<Entity> = { cypher, params };

    // Add execute method if we have an entity manager
    if (this.em) {
      result.execute = async () => {
        return this.em!.getConnection().execute<Entity[]>(cypher, params);
      };
    }

    return result;
  }

  /**
   * Resolves a property path (e.g., 'name', 'p.name', 'node.price') to a Cypher.Property.
   * Handles tracked variables, the return alias, and automatic joining of relationships.
   */
  private resolvePropertyPath(path: string): Cypher.Property {
    if (this.meta && this.meta.properties[path as EntityKey<Entity>]) {
      return this.node.property(path);
    }

    const [pref, propName] = path.split('.');
    const variable = this.variables.get(pref);

    if (variable instanceof Cypher.Node || variable instanceof Cypher.Variable) {
      return (variable as Cypher.Node).property(propName);
    }

    // If it matches the return alias, it's a reference to the projected result
    if (pref === this.returnAlias) {
      return new Cypher.NamedVariable(pref).property(propName);
    }

    // Auto-joining: If prefix matches a relationship property of the root node, join it automatically
    if (this.meta && this.meta.properties[pref as keyof EntityMetadata<Entity>['properties']]) {
      const prop = this.meta.properties[pref as keyof EntityMetadata<Entity>['properties']];
      if (prop.kind !== ReferenceKind.SCALAR) {
        // Automatically join the relationship using the property name as the alias
        this.join(pref, pref);
        const joinedVariable = this.variables.get(pref);
        if (joinedVariable) {
          return (joinedVariable as any).property(propName);
        }
      }
    }

    // Fallback to treat the whole thing as a property of the main node
    return this.node.property(path);
  }

  /**
   * Builds and executes the query, returning the results.
   * Requires an EntityManager to be provided during construction.
   *
   * @returns Promise with query results
   * @example
   * ```typescript
   * const movies = await qb.match().where('title', 'The Matrix').execute();
   * ```
   */
  async execute(): Promise<Entity[]> {
    const { cypher, params } = this.build();

    if (!this.em) {
      throw new Error(
        'Cannot execute query without an EntityManager. Use build() and execute manually.',
      );
    }

    // Use the EntityManager's run method which properly converts Neo4j types
    return (this.em as Neo4jEntityManager).run(cypher, params) as Promise<Entity[]>;
  }

  /**
   * Builds and executes the query, returning all matching results.
   * Alias for execute() with more intuitive naming.
   * Requires an EntityManager to be provided during construction.
   *
   * @returns Promise with array of query results
   * @example
   * ```typescript
   * const movies = await qb.match().where('released', 1999).getMany();
   * ```
   */
  async getMany(): Promise<Entity[]> {
    return this.execute();
  }

  /**
   * Builds and executes the query, returning the first result or null.
   * Automatically adds LIMIT 1 to the query.
   * Requires an EntityManager to be provided during construction.
   *
   * @returns Promise with single result or null if not found
   * @example
   * ```typescript
   * const movie = await qb.match().where('title', 'The Matrix').getOne();
   * ```
   */
  async getOne(): Promise<Entity | null> {
    if (!this.em) {
      throw new Error(
        'Cannot execute query without an EntityManager. Use build() and execute manually.',
      );
    }

    // Ensure we only fetch one result
    this.limit(1);

    const { cypher, params } = this.build();
    const result = (await (this.em as any).run(cypher, params)) as Entity[];
    return result.length > 0 ? result[0] : null;
  }

  /**
   * Helper to convert a property object to Cypher params.
   */
  private convertPropertiesToParams(
    properties: Record<string, unknown>,
  ): Record<string, Cypher.Param> {
    const params: Record<string, Cypher.Param> = {};
    for (const [key, value] of Object.entries(properties)) {
      params[key] = new Cypher.Param(value);
    }
    return params;
  }
}
