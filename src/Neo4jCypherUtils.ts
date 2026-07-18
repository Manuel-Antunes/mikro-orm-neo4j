import Cypher from '@neo4j/cypher-builder';
import {
  type Dictionary,
  type EntityMetadata,
  type FilterQuery,
  type QueryOrderMap,
  isRaw,
} from '@mikro-orm/core';
import { Neo4jCypherBuilder } from './Neo4jCypherBuilder.js';

/**
 * Shared utility class for building Cypher query primitives.
 * Provides the single source of truth for:
 * - WHERE clause translation (MikroORM FilterQuery → Cypher predicates)
 * - ORDER BY clause translation
 * - Neo4j native value conversion (Integer, arrays, nested objects)
 * - Pattern/MATCH boilerplate
 *
 * Used by both Neo4jDriver (internal CRUD) and Neo4jQueryBuilder (userland API).
 */
export class Neo4jCypherUtils {
  /**
   * Unified WHERE clause builder. Works with any Cypher.Variable subclass
   * (Cypher.Node, Cypher.Relationship, etc.).
   *
   * Translates MikroORM FilterQuery operators to @neo4j/cypher-builder predicates:
   * - `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`
   * - `$and`, `$or` (recursive)
   * - Plain `{ key: value }` → equality
   * - `$in` → Cypher IN operator
   *
   * @param variable - The Cypher variable (Node or Relationship) to build predicates against
   * @param where - MikroORM-style filter query object
   * @returns Array of Cypher predicates to be combined with Cypher.and()
   */
  static buildWhereClauses<T extends object>(
    variable: Cypher.Variable,
    where: FilterQuery<T>,
  ): Cypher.Predicate[] {
    if (!where || (typeof where === 'object' && Object.keys(where).length === 0)) {
      return [];
    }

    const clauses: Cypher.Predicate[] = [];

    Object.entries(where as Dictionary).forEach(([key, value]) => {
      // Handle $and operator
      if (key === '$and' && Array.isArray(value)) {
        const nested = value.flatMap((v) => this.buildWhereClauses(variable, v as FilterQuery<T>));
        if (nested.length > 0) {
          const andClause = Cypher.and(...nested);
          if (andClause) {
            clauses.push(andClause);
          }
        }
        return;
      }

      // Handle $or operator
      if (key === '$or' && Array.isArray(value)) {
        const nested = value.flatMap((v) => this.buildWhereClauses(variable, v as FilterQuery<T>));
        if (nested.length > 0) {
          const orClause = Cypher.or(...nested);
          if (orClause) {
            clauses.push(orClause);
          }
        }
        return;
      }

      // Handle operator objects: { field: { $gt: 5, $lt: 10 } }
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const prop = variable.property(key);
        let appliedOperator = false;

        Object.entries(value as Dictionary).forEach(([op, opValue]) => {
          switch (op) {
            case '$eq':
              clauses.push(Cypher.eq(prop, new Cypher.Param(opValue)));
              appliedOperator = true;
              break;
            case '$ne':
              clauses.push(Cypher.neq(prop, new Cypher.Param(opValue)));
              appliedOperator = true;
              break;
            case '$gt':
              clauses.push(Cypher.gt(prop, new Cypher.Param(opValue)));
              appliedOperator = true;
              break;
            case '$gte':
              clauses.push(Cypher.gte(prop, new Cypher.Param(opValue)));
              appliedOperator = true;
              break;
            case '$lt':
              clauses.push(Cypher.lt(prop, new Cypher.Param(opValue)));
              appliedOperator = true;
              break;
            case '$lte':
              clauses.push(Cypher.lte(prop, new Cypher.Param(opValue)));
              appliedOperator = true;
              break;
            case '$in':
              if (Array.isArray(opValue)) {
                clauses.push(Cypher.in(prop, new Cypher.Param(opValue)));
                appliedOperator = true;
              }
              break;
            default:
              break;
          }
        });

        // If no recognized operator was found, treat it as an equality check
        // (e.g., nested object value)
        if (!appliedOperator) {
          clauses.push(Cypher.eq(prop, new Cypher.Param(value)));
        }

        return;
      }

      // Handle RawQueryFragment: { title: raw('UPPER(n.title)') }
      if (isRaw(value)) {
        clauses.push(new Cypher.Raw(() => `${key} = ${value.sql}`));
        return;
      }

      // Simple equality: { key: value }
      clauses.push(Cypher.eq(variable.property(key), new Cypher.Param(value)));
    });

    return clauses;
  }

  /**
   * Unified ORDER BY clause builder. Works with any Cypher.Variable subclass.
   *
   * @param variable - The Cypher variable to order by properties of
   * @param orderBy - MikroORM-style order map(s)
   * @returns Array of [property, direction] tuples for Cypher orderBy
   */
  static buildOrderClauses<T extends object>(
    variable: Cypher.Variable,
    orderBy?: QueryOrderMap<T> | QueryOrderMap<T>[],
  ): [Cypher.Expr | Cypher.Property, 'ASC' | 'DESC'][] {
    if (!orderBy || (Array.isArray(orderBy) && orderBy.length === 0)) {
      return [];
    }

    const parts: [Cypher.Expr | Cypher.Property, 'ASC' | 'DESC'][] = [];
    const arr = Array.isArray(orderBy) ? orderBy : [orderBy];

    for (const item of arr) {
      Object.entries(item as Dictionary).forEach(([field, dir]) => {
        const prop = variable.property(field);
        const direction: 'ASC' | 'DESC' = String(dir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
        parts.push([prop, direction]);
      });
    }

    return parts;
  }

  /**
   * Deep-converts Neo4j native values to JavaScript values.
   * Handles:
   * - Neo4j Integer objects ({low, high}) → number
   * - Arrays (recursive)
   * - Nested plain objects (recursive)
   * - Scalar pass-through
   *
   * @param value - Any value that may contain Neo4j native types
   * @returns The converted JavaScript value
   */
  static convertNeo4jValue(value: unknown): unknown {
    // Handle Neo4j Integer objects
    if (value && typeof value === 'object' && 'low' in value && 'high' in value) {
      const v = value as { low: number; high: number; toNumber?: () => number };
      return v.toNumber ? v.toNumber() : Number(v.low);
    }

    // Handle arrays recursively
    if (Array.isArray(value)) {
      return value.map((v) => this.convertNeo4jValue(v));
    }

    // Handle plain objects recursively
    if (value && typeof value === 'object' && value.constructor === Object) {
      const converted: Record<string, unknown> = {};
      const record = value as Record<string, unknown>;
      for (const key in record) {
        converted[key] = this.convertNeo4jValue(record[key]);
      }
      return converted;
    }

    return value;
  }

  /**
   * Converts all values in a Neo4j record/properties object.
   *
   * @param record - Object whose values may contain Neo4j native types
   * @returns New object with all values converted to JavaScript types
   */
  static convertNeo4jRecord(record: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key in record) {
      result[key] = this.convertNeo4jValue(record[key]);
    }
    return result;
  }

  /**
   * Creates a MATCH clause with proper labels from entity metadata.
   * Eliminates the repeated boilerplate of creating Node → Pattern → Match.
   *
   * @param meta - MikroORM entity metadata
   * @returns Object with the Cypher node, pattern, and match clause
   */
  static createNodeMatch<T extends object>(
    meta: EntityMetadata<T>,
  ): { node: Cypher.Node; pattern: Cypher.Pattern; clause: Cypher.Match } {
    const labels = Neo4jCypherBuilder.getNodeLabels(meta);
    const node = new Cypher.Node();
    const pattern = new Cypher.Pattern(node, { labels });
    const clause = new Cypher.Match(pattern);
    return { node, pattern, clause };
  }

  /**
   * Builds a directional relationship pattern between two nodes.
   * Handles IN (left), OUT (right), and undirected patterns.
   *
   * @param sourceNode - The source/origin node
   * @param targetNode - The target/destination node
   * @param relType - The relationship type string (e.g., 'ACTED_IN')
   * @param direction - 'IN', 'OUT', or undefined (undirected)
   * @param rel - Optional existing Cypher.Relationship variable to reuse
   * @param targetLabels - Optional labels for the target node
   * @returns A Cypher.Pattern representing the directional relationship
   */
  static buildRelationshipPattern(
    sourceNode: Cypher.Node,
    targetNode: Cypher.Node,
    relType: string,
    direction: 'IN' | 'OUT' | undefined,
    rel?: Cypher.Relationship,
    targetLabels?: string[],
  ): Cypher.Pattern {
    const relationship = rel ?? new Cypher.Relationship();
    const targetOpts = targetLabels ? { labels: targetLabels } : undefined;

    if (direction === 'OUT') {
      return new Cypher.Pattern(sourceNode)
        .related(relationship, { type: relType, direction: 'right' })
        .to(targetNode, targetOpts);
    }
    if (direction === 'IN') {
      return new Cypher.Pattern(targetNode, targetOpts)
        .related(relationship, { type: relType, direction: 'right' })
        .to(sourceNode);
    }
    // Undirected
    return new Cypher.Pattern(sourceNode)
      .related(relationship, { type: relType })
      .to(targetNode, targetOpts);
  }

  /**
   * Applies WHERE predicates to a clause if there are any matching filters.
   * Convenience method that combines buildWhereClauses + Cypher.and.
   *
   * @param clause - The Cypher clause to attach WHERE to
   * @param variable - The Cypher variable to filter on
   * @param where - MikroORM-style filter query
   * @returns The clause with WHERE applied (if filters exist), or the original clause
   */
  static applyWhere<T extends object>(
    clause: Cypher.Clause,
    variable: Cypher.Variable,
    where: FilterQuery<T>,
  ): Cypher.Clause {
    if (where && Object.keys(where).length > 0) {
      const whereClauses = this.buildWhereClauses(variable, where);
      if (whereClauses.length > 0) {
        // cast to any here because @neo4j/cypher-builder doesn't expose where() on base Clause
        return (clause as any).where(Cypher.and(...whereClauses));
      }
    }
    return clause;
  }

  /**
   * Builds an equality predicate that matches a node by its COMPLETE primary
   * key, iterating every property returned by `getPrimaryProps()` instead of
   * hardcoding `"id"`.
   *
   * This is what closes the cross-tenant relationship leak (C11): when the PK
   * is composite (e.g. `(tenant, id)`) two different tenants can share the same
   * business `id`, and matching on `id` alone would attach an edge to both
   * nodes. Matching on the full PK isolates the correct endpoint.
   *
   * @param node - the Cypher node variable to constrain
   * @param meta - entity metadata (source of the primary props)
   * @param idValue - the PK value: a scalar for a single-column PK, or an
   *   object keyed by PK property name for a composite PK
   */
  static pkPredicate<T extends object>(
    node: Cypher.Node,
    meta: EntityMetadata<T> | undefined,
    idValue: unknown,
  ): Cypher.Predicate {
    const pks = meta?.getPrimaryProps() ?? [];
    // Fallback for targets without metadata (string-typed relations): match by id.
    if (pks.length === 0) {
      return Cypher.eq(node.property('id'), new Cypher.Param(idValue));
    }
    const preds = pks.map((pk) => {
      const value =
        pks.length === 1 && (typeof idValue !== 'object' || idValue === null)
          ? idValue
          : (idValue as Dictionary)?.[pk.name];
      return Cypher.eq(node.property(pk.name), new Cypher.Param(value));
    });
    return preds.length === 1 ? preds[0] : Cypher.and(...preds)!;
  }

  /**
   * Extracts the primary-key value out of a node's raw property bag, converting
   * Neo4j native types along the way.
   *
   * @returns a scalar for a single-column PK, or a `{ [pkName]: value }` object
   *   for a composite PK (the shape `pkPredicate` expects downstream).
   */
  static extractPk<T extends object>(meta: EntityMetadata<T>, props: Dictionary): unknown {
    const pks = meta.getPrimaryProps();
    if (pks.length === 1) {
      return this.convertNeo4jValue(props?.[pks[0].name]);
    }
    const pk: Dictionary = {};
    for (const p of pks) {
      pk[p.name] = this.convertNeo4jValue(props?.[p.name]);
    }
    return pk;
  }

  /**
   * Normalizes the value of a relationship endpoint into the PK shape used for
   * matching: a scalar for a single-column PK, or a `{ [pkName]: value }`
   * object for a composite PK.
   *
   * The endpoint arrives in several forms depending on how MikroORM serialized
   * it:
   * - a scalar id (single PK given directly);
   * - a positional array `[id, tenant]` (MikroORM's wire format for a composite
   *   FK, ordered to match `getPrimaryProps()`);
   * - an entity/reference object keyed by PK property name.
   */
  static extractRelatedPk<T extends object>(
    meta: EntityMetadata<T> | undefined,
    val: unknown,
  ): unknown {
    if (val === null || val === undefined) {
      return val;
    }
    const pks = meta?.getPrimaryProps() ?? [];
    if (pks.length === 0) {
      return val;
    }
    // Composite key delivered as a positional array, in primary-prop order.
    if (Array.isArray(val)) {
      if (pks.length === 1) {
        return val[0];
      }
      const pk: Dictionary = {};
      pks.forEach((p, i) => {
        pk[p.name] = val[i];
      });
      return pk;
    }
    // Scalar id given directly.
    if (typeof val !== 'object') {
      return val;
    }
    if (pks.length === 1) {
      return (val as Dictionary)[pks[0].name] ?? val;
    }
    const pk: Dictionary = {};
    for (const p of pks) {
      pk[p.name] = (val as Dictionary)[p.name];
    }
    return pk;
  }
}
