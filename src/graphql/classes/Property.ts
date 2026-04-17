import type { Directive } from '../types.js';

export default class Property {
  name: string;
  types: string[];
  mandatory: boolean;
  description?: string;
  directives: Directive[] = [];

  constructor(
    name: string,
    types: string[],
    mandatory: boolean,
    description?: string,
    directives: Directive[] = [],
  ) {
    this.name = name;
    this.types = types;
    this.mandatory = mandatory;
    this.description = description;
    this.directives = directives;
  }
}
