import '@mikro-orm/core';

declare module '@mikro-orm/core' {
  export interface PropertyOptions<Owner, Target> {
    relation?: {
      type?: string;
      direction?: 'IN' | 'OUT';
      [key: string]: any;
    };
  }

  export interface EntityOptions<T> {
    neo4j?: {
      labels?: string[];
      type?: string;
      relationshipEntity?: boolean;
      [key: string]: any;
    };
  }

  export interface ReferenceOptions<Owner, Target> {
    relation?: {
      type?: string;
      direction?: 'IN' | 'OUT';
      [key: string]: any;
    };
  }
}
