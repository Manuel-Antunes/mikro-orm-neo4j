import Cypher from '@neo4j/cypher-builder';
import {
  type Dictionary,
  type EntityMetadata,
  type FilterQuery,
  type QueryOrderMap,
} from '@mikro-orm/core';
import { Neo4jCypherBuilder } from './Neo4jCypherBuilder';

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
  ): [any, 'ASC' | 'DESC'][] {
    if (!orderBy || (Array.isArray(orderBy) && orderBy.length === 0)) {
      return [];
    }

    const parts: [any, 'ASC' | 'DESC'][] = [];
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
  static convertNeo4jValue(value: any): any {
    // Handle Neo4j Integer objects
    if (value && typeof value === 'object' && 'low' in value && 'high' in value) {
      return value.toNumber ? value.toNumber() : Number(value.low);
    }

    // Handle arrays recursively
    if (Array.isArray(value)) {
      return value.map((v) => this.convertNeo4jValue(v));
    }

    // Handle plain objects recursively
    if (value && typeof value === 'object' && value.constructor === Object) {
      const converted: any = {};
      for (const key in value) {
        converted[key] = this.convertNeo4jValue(value[key]);
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
  static convertNeo4jRecord(record: any): any {
    const result: any = {};
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
    clause: any,
    variable: Cypher.Variable,
    where: FilterQuery<T>,
  ): any {
    if (where && Object.keys(where).length > 0) {
      const whereClauses = this.buildWhereClauses(variable, where);
      if (whereClauses.length > 0) {
        return clause.where(Cypher.and(...whereClauses));
      }
    }
    return clause;
  }
}
