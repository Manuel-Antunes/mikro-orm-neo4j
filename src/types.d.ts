import '@mikro-orm/core';

declare module '@mikro-orm/core' {
  export interface PropertyOptions<Owner> {
    relationship?: {
      type?: string;
      direction?: 'IN' | 'OUT';
      [key: string]: any;
    };
  }

  export interface EntityMetadata {
    labels?: string[];
    relationship?: boolean | { type?: string; direction?: 'IN' | 'OUT' };
  }

  export interface EntityProperty {
    relationship?: { type?: string; direction?: 'IN' | 'OUT' };
  }

  export type EntityOptions<T, E = T extends EntityClass<infer P> ? P : T> = {
    /** Override default collection/table name. Alias for `collection`. */
    tableName?: string;
    /** Sets the schema name. */
    schema?: string;
    /** Override default collection/table name. Alias for `tableName`. */
    collection?: string;
    /**
     * Set default ordering for this entity. This ordering is applied when:
     * - Querying the entity directly via `em.find()`, `em.findAll()`, etc.
     * - Populating the entity as a relation
     *
     * All orderings are combined together. Precedence (highest to lowest):
     * 1. Runtime `FindOptions.orderBy`
     * 2. Relation-level `@OneToMany({ orderBy })` / `@ManyToMany({ orderBy })`
     * 3. Entity-level `@Entity({ orderBy })`
     */
    orderBy?: QueryOrderMap<E> | QueryOrderMap<E>[];
    /** For {@doclink inheritance-mapping#single-table-inheritance | Single Table Inheritance}. */
    discriminatorColumn?: (T extends EntityClass<infer P> ? keyof P : string) | AnyString;
    /** For {@doclink inheritance-mapping#single-table-inheritance | Single Table Inheritance}. */
    discriminatorMap?: Dictionary<string>;
    /** For {@doclink inheritance-mapping#single-table-inheritance | Single Table Inheritance}. */
    discriminatorValue?: number | string;
    /** Set inheritance strategy: 'tpt' for {@doclink inheritance-mapping#table-per-type-inheritance-tpt | Table-Per-Type} inheritance. When set on the root entity, each entity in the hierarchy gets its own table with a FK from child PK to parent PK. */
    inheritance?: 'tpt';
    /**	Enforce use of constructor when creating managed entity instances. */
    forceConstructor?: boolean;
    /** Specify constructor parameters to be used in `em.create` or when `forceConstructor` is enabled. Those should be names of declared entity properties in the same order as your constructor uses them. The ORM tries to infer those automatically, use this option in case the inference fails. */
    constructorParams?: (T extends EntityClass<infer P> ? keyof P : string)[];
    /** Specify comment to table. (SQL only) */
    comment?: string;
    /**	Marks entity as abstract, such entities are inlined during discovery. */
    abstract?: boolean;
    /** Disables change tracking - such entities are ignored during flush. */
    readonly?: boolean;
    /** Marks entity as {@doclink virtual-entities | virtual}. This is set automatically when you use `expression` option (unless `view` is set). */
    virtual?: boolean;
    /**
     * Marks entity as a database view. Unlike virtual entities which evaluate expressions at query time,
     * view entities create actual database views. The `expression` option must be provided when `view` is true.
     * View entities are read-only by default.
     *
     * Use `view: true` for regular views, or `view: { materialized: true }` for materialized views (PostgreSQL only).
     * Materialized views store the query results and must be refreshed to update data.
     * Use `view: { materialized: true, withData: false }` to create an unpopulated materialized view.
     */
    view?:
      | boolean
      | {
          materialized?: boolean;
          withData?: boolean;
        };
    /** Used to make ORM aware of externally defined triggers. This is needed for MS SQL Server multi inserts, ignored in other dialects. */
    hasTriggers?: boolean;
    /** SQL query that maps to a {@doclink virtual-entities | virtual entity}, or for view entities, the view definition. */
    expression?:
      | string
      | ((
          em: any,
          where: ObjectQuery<E>,
          options: FindOptions<E, any, any, any>,
          stream?: boolean,
        ) => object);
    /** Set {@doclink repositories#custom-repository | custom repository class}. */
    repository?: () => Constructor;
    /** Neo4j specific options */
    /** Labels for the node */
    labels?: string[];
    /** Relationship options */
    relationship?:
      | boolean
      | {
          /** Relationship type */
          type?: string;
          /** Relationship direction */
          direction?: 'IN' | 'OUT';
        };
  };

  export interface ReferenceOptions<Owner, Target> {
    relationship?: {
      type?: string;
      direction?: 'IN' | 'OUT';
      [key: string]: any;
    };
  }
}
