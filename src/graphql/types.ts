/*
 * Copyright (c) "Neo4j"
 * Neo4j Sweden AB [http://neo4j.com]
 */

export type Direction = 'IN' | 'OUT';
export interface Directive {
  toString(): string;
}

export type ExcludeOperation = 'CREATE' | 'READ' | 'UPDATE' | 'DELETE';

/*
 * Copyright (c) "Neo4j"
 * Neo4j Sweden AB [http://neo4j.com]
 */

import type Property from './classes/Property';
import type Relationship from './classes/Relationship';

export type Node = {
  typeId: string;
  labels: string[];
  properties: Property[];
  relationships: Relationship[];
  description?: string;
  isNode?: boolean;
};

export type Neo4jStruct = {
  nodes: Record<string, Node>;
  relationships: Record<string, Relationship>;
};

export type PropertyRecord = {
  propertyName: string;
  propertyTypes: string[];
  mandatory: boolean;
};

export type NodeMap = {
  [key: string]: Node;
};

export type RelationshipMap = {
  [key: string]: Relationship;
};
