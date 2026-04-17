/*
 * Copyright (c) "Neo4j"
 * Neo4j Sweden AB [http://neo4j.com]
 */

import type { Directive } from '../types';

export class CypherDirective implements Directive {
  constructor(
    private readonly statement: string,
    private readonly columnName: string = 'this',
  ) {}

  toString(): string {
    return `@cypher(statement: """\n${this.statement.trim()}\n""", columnName: "${this.columnName}")`;
  }
}
