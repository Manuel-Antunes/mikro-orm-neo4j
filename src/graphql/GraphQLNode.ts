/*
 * Copyright (c) "Neo4j"
 * Neo4j Sweden AB [http://neo4j.com]
 */

import type { NodeField } from './NodeField';
import type { Directive } from './types';

type NodeType = 'type' | 'interface';

export class GraphQLNode {
  type: NodeType;
  typeName: string;
  fields: NodeField[] = [];
  directives: Directive[] = [];
  description?: string;

  constructor(type: NodeType, typeName: string, description?: string) {
    this.type = type;
    this.typeName = typeName;
    this.description = description;
  }

  addDirective(d: Directive) {
    this.directives.push(d);
  }

  addField(field: NodeField) {
    this.fields.push(field);
  }

  toString() {
    const parts: (string | string[])[] = [];
    let innerParts: string[] = [];
    const typeRow: string[] = [];

    if (this.description) {
      parts.push(`"""\n${this.description}\n"""`);
    }

    typeRow.push(this.type, this.typeName);
    if (this.directives.length) {
      typeRow.push(this.directives.map((d) => d.toString()).join(' '));
    }
    typeRow.push('{');

    innerParts = innerParts.concat(this.fields.map((field) => field.toString()));

    parts.push(typeRow.join(' '));
    parts.push(innerParts);
    parts.push(`}`);
    return parts
      .map((p) => {
        if (Array.isArray(p)) {
          return p
            .map((line) =>
              line
                .split('\n')
                .map((l) => `  ${l}`)
                .join('\n'),
            )
            .join('\n\n');
        }
        return p;
      })
      .join('\n');
  }
}
