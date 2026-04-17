import { type EntityMetadata, type EntityProperty, ReferenceKind } from '@mikro-orm/core';

/** Helper: read Neo4j-specific metadata stored on MikroORM properties. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readPropertyOption(obj: EntityProperty<any, any>): Record<string, unknown> {
  return (obj.relationship as Record<string, unknown>) ?? {};
}

/**
 * Utility class for extracting Neo4j-specific metadata from MikroORM entity metadata.
 * Reads from `relationship: { type, direction }` on @ManyToOne/ManyToMany options and `labels: string[]`, `relationship: boolean | { type: string }` on @Entity().
 */
export class Neo4jCypherBuilder {
  /**
   * Extracts Neo4j labels from entity metadata.
   * Primary label is the explicitly configured name/collection or falls back to className.
   * Additional labels come from `labels`.
   */
  static getNodeLabels<T extends object>(meta: EntityMetadata<T>): string[] {
    const primaryLabel = meta.collection ?? meta.className;
    const labelsSet = new Set<string>();
    labelsSet.add(primaryLabel);

    const additionalLabels = meta.labels;
    if (additionalLabels && Array.isArray(additionalLabels)) {
      additionalLabels.forEach((label) => labelsSet.add(label));
    }

    return Array.from(labelsSet);
  }

  /**
   * Gets the relationship type from property custom options or falls back to the property name.
   * Reads `relationship.type` from the property metadata.
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
   * Not used directly when direction is passed through property.relationship — kept for API compatibility.
   */
  static getRelationshipDirection(
    _sourceEntity: object,
    _propertyName: string,
  ): 'IN' | 'OUT' | undefined {
    return undefined;
  }

  /**
   * Checks if an entity is a relationship entity (pivot entity used for relationship properties).
   * Detected via `meta.pivotTable` flag set by MikroORM, or via `relationship: true | { ... }`.
   */
  static isRelationshipEntity<T extends object>(meta: EntityMetadata<T>): boolean {
    const rel = meta.relationship;
    return !!meta.pivotTable || rel === true || (typeof rel === 'object' && rel !== null);
  }

  /**
   * Gets the relationship type string for a relationship entity (pivot).
   * Reads `relationship.type`, falls back to `meta.name` or `meta.collection` uppercased.
   */
  static getRelationshipEntityType<T extends object>(meta: EntityMetadata<T>): string {
    const rel = meta.relationship;
    const type = typeof rel === 'object' && rel !== null ? rel.type : undefined;
    const fallback = meta.name ?? meta.collection;
    return type ?? fallback.toUpperCase();
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
