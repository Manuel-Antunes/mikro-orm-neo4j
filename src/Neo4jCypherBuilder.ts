import { type EntityMetadata, type EntityProperty, ReferenceKind } from '@mikro-orm/core';

/** Helper: read Neo4j-specific metadata stored on MikroORM properties. */
function readPropertyOption(obj: unknown): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((obj as any).relation as Record<string, unknown>) ?? {};
}

/** Helper: read Neo4j-specific metadata stored on MikroORM entities. */
function readEntityOption(obj: unknown): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((obj as any).neo4j as Record<string, unknown>) ?? {};
}

/**
 * Utility class for extracting Neo4j-specific metadata from MikroORM entity metadata.
 * Reads from `relation: { type, direction }` on @ManyToOne/ManyToMany options and `neo4j: { labels, relationshipEntity, type }` on @Entity().
 */
export class Neo4jCypherBuilder {
  /**
   * Extracts Neo4j labels from entity metadata.
   * Primary label is the collection name; additional labels come from `neo4j.labels`.
   */
  static getNodeLabels<T extends object>(meta: EntityMetadata<T>): string[] {
    // `collection` is set after full metadata discovery; for defineEntity schemas used
    // before discovery completes, fall back to the lowercased className.
    const primaryLabel = meta.collection ?? meta.className.toLowerCase();
    const labels = [primaryLabel];
    const additionalLabels = readEntityOption(meta).labels;

    if (additionalLabels && Array.isArray(additionalLabels)) {
      labels.push(...(additionalLabels as string[]));
    }

    return labels;
  }

  /**
   * Gets the relationship type from property custom options or falls back to the property name.
   * Reads `relation.type` from the property metadata.
   * For ManyToMany with a pivot entity, falls back to the pivot entity name uppercased.
   */
  static getRelationshipType<T extends object>(
    _sourceEntity: EntityMetadata<T> | object,
    property: EntityProperty | string,
    allowFallback = true,
  ): string | undefined {
    let propMetadata: EntityProperty | undefined;
    if (typeof property !== 'string') {
      propMetadata = property;
    }

    // Try to get from property metadata
    if (propMetadata) {
      const relation = readPropertyOption(propMetadata);
      if (relation.type && typeof relation.type === 'string') {
        return relation.type;
      }
      // If it's a ManyToMany with a pivot entity, derive from pivot entity name
      if (propMetadata.kind === ReferenceKind.MANY_TO_MANY && propMetadata.pivotEntity) {
        const pivotEntity = propMetadata.pivotEntity as string | { name: string };
        const pivotName = typeof pivotEntity === 'string' ? pivotEntity : pivotEntity.name;
        return pivotName.toUpperCase();
      }
    }

    // If no metadata found and fallback not allowed, return undefined
    if (!allowFallback) {
      return undefined;
    }

    // Default: uppercase property name
    const propertyName = typeof property === 'string' ? property : property.name;
    return propertyName.toUpperCase();
  }

  /**
   * Gets the relationship direction from property relation payload.
   * Not used directly when direction is passed through property.relation — kept for API compatibility.
   */
  static getRelationshipDirection(
    _sourceEntity: object,
    _propertyName: string,
  ): 'IN' | 'OUT' | undefined {
    return undefined;
  }

  /**
   * Checks if an entity is a relationship entity (pivot entity used for relationship properties).
   * Detected via `meta.pivotTable` flag set by MikroORM, or via `neo4j.relationshipEntity: true`.
   */
  static isRelationshipEntity<T extends object>(meta: EntityMetadata<T>): boolean {
    return !!meta.pivotTable || readEntityOption(meta).relationshipEntity === true;
  }

  /**
   * Gets the relationship type string for a relationship entity (pivot).
   * Reads `neo4j.type`, falls back to collection name uppercased.
   */
  static getRelationshipEntityType<T extends object>(meta: EntityMetadata<T>): string {
    const neo4j = readEntityOption(meta);
    return (
      (typeof neo4j.type === 'string' ? neo4j.type : undefined) ?? meta.collection.toUpperCase()
    );
  }

  /**
   * Finds the two reference properties (ManyToOne / OneToOne) in a relationship entity.
   */
  static getRelationshipEntityEnds<T extends object>(
    meta: EntityMetadata<T>,
  ): [EntityProperty<T>, EntityProperty<T>] {
    const props = Object.values(meta.properties) as EntityProperty<T>[];
    const manyToOneProps = props.filter(
      (p) => p.kind === ReferenceKind.MANY_TO_ONE || p.kind === ReferenceKind.ONE_TO_ONE,
    );

    if (manyToOneProps.length !== 2) {
      throw new Error(
        `Relationship entity ${meta.className} must have exactly 2 reference properties, found ${manyToOneProps.length}`,
      );
    }

    return [manyToOneProps[0], manyToOneProps[1]];
  }

  /**
   * Formats node labels as a Cypher label string (:Label1:Label2).
   */
  static getNodeLabelsString<T extends object>(meta: EntityMetadata<T>): string {
    const labels = this.getNodeLabels(meta);
    return ':' + labels.join(':');
  }
}
