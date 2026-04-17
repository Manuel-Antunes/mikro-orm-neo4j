/*
 * Copyright (c) "Neo4j"
 * Neo4j Sweden AB [http://neo4j.com]
 */

import type { Directive } from './types';

export class NodeField {
  name: string;
  type: string;
  directives: Directive[] = [];
  description?: string;

  constructor(name: string, type: string, description?: string) {
    this.name = name;
    this.type = type;
    this.description = description;
  }

  addDirective(d: Directive): void {
    this.directives.push(d);
  }

  toString(): string {
    const parts: string[] = [];
    if (this.description) {
      parts.push(`"""\n${this.description}\n"""`);
    }
    const directiveString = this.directives?.map((d) => d.toString()).join(' ') || '';
    parts.push(`${this.name}: ${this.type}${directiveString ? ` ${directiveString}` : ''}`);
    return parts.join('\n');
  }
}
