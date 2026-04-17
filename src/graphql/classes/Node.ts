/*
 * Copyright (c) "Neo4j"
 * Neo4j Sweden AB [http://neo4j.com]
 */

import type Property from './Property';
import type Relationship from './Relationship';

export default class Node {
  typeId: string;
  labels: string[];
  properties: Property[] = [];
  relationships: Relationship[] = [];
  description?: string;
  isNode?: boolean;

  constructor(typeId: string, labels: string[], description?: string, isNode?: boolean) {
    this.typeId = typeId;
    this.labels = labels;
    this.description = description;
    this.isNode = isNode;
  }

  addProperty(property: Property): void {
    if (this.properties.some((p) => p.name === property.name)) {
      return;
    }
    this.properties.push(property);
  }

  addRelationship(relationship: Relationship): void {
    if (this.relationships.some((r) => r.type === relationship.type)) {
      return;
    }
    this.relationships.push(relationship);
  }
}
