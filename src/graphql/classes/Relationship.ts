/*
 * Copyright (c) "Neo4j"
 * Neo4j Sweden AB [http://neo4j.com]
 */

import type Property from './Property';

interface Path {
  fromTypeId: string;
  toTypeId: string;
  fromFieldName?: string;
  toFieldName?: string;
}

export default class Relationship {
  type: string;
  paths: Path[] = [];
  properties: Property[] = [];
  description?: string;
  propertiesTypeName?: string;

  constructor(type: string, description?: string) {
    this.type = type;
    this.description = description;
  }

  addProperty(property: Property): void {
    if (this.properties.some((p) => p.name === property.name)) {
      return;
    }
    this.properties.push(property);
  }

  addPath(from: string, to: string, fromFieldName?: string, toFieldName?: string): void {
    this.paths.push({ fromTypeId: from, toTypeId: to, fromFieldName, toFieldName });
  }
}
