import { describe, expect, test } from 'vitest';
import { Neo4jSchemaCypherGenerator } from '../src/graphql/Neo4jSchemaCypherGenerator.js';
import graphqlFormatter from '../src/graphql/graphql.js';

describe('Neo4j schema generator interface support', () => {
  test('generates interface SDL with @declareRelationship and implementing types', () => {
    const metadata = [
      {
        className: 'DefinePerson',
        collection: 'define_person',
        labels: ['Person'],
        comment: 'Person node',
        virtual: false,
        embeddable: false,
        inheritance: undefined,
        relationship: undefined,
        extends: undefined,
        props: [
          {
            name: 'id',
            kind: 'scalar',
            type: 'string',
            nullable: false,
            primary: true,
            embedded: false,
          },
          { name: 'name', kind: 'scalar', type: 'string', nullable: false, embedded: false },
        ],
      },
      {
        className: 'DefineProduction',
        collection: 'define_production',
        labels: [],
        comment: 'Production interface',
        virtual: false,
        embeddable: false,
        inheritance: 'interface',
        relationship: undefined,
        extends: undefined,
        props: [
          {
            name: 'title',
            kind: 'scalar',
            type: 'string',
            nullable: false,
            primary: false,
            embedded: false,
          },
          {
            name: 'actors',
            kind: 'm:n',
            type: 'DefinePerson',
            nullable: false,
            primary: false,
            embedded: false,
          },
        ],
      },
      {
        className: 'DefineMovie',
        collection: 'define_movie',
        labels: ['Movie'],
        comment: 'Movie node',
        virtual: false,
        embeddable: false,
        inheritance: undefined,
        relationship: undefined,
        extends: 'DefineProduction',
        props: [
          {
            name: 'released',
            kind: 'scalar',
            type: 'number',
            nullable: false,
            primary: false,
            embedded: false,
          },
          {
            name: 'actors',
            kind: 'm:n',
            type: 'DefinePerson',
            nullable: false,
            primary: false,
            embedded: false,
            relationship: { type: 'ACTED_IN', direction: 'IN' },
          },
        ],
      },
      {
        className: 'DefineSeries',
        collection: 'define_series',
        labels: ['Series'],
        comment: 'Series node',
        virtual: false,
        embeddable: false,
        inheritance: undefined,
        relationship: undefined,
        extends: 'DefineProduction',
        props: [
          {
            name: 'episodes',
            kind: 'scalar',
            type: 'number',
            nullable: false,
            primary: false,
            embedded: false,
          },
          {
            name: 'actors',
            kind: 'm:n',
            type: 'DefinePerson',
            nullable: false,
            primary: false,
            embedded: false,
            relationship: { type: 'ACTED_IN', direction: 'IN' },
          },
        ],
      },
    ];

    const metadataStorage = {
      getAll: () => metadata,
      get: (target: unknown) => {
        if (typeof target === 'function') {
          return metadata.find((meta) => meta.className === (target as { name: string }).name);
        }
        if (typeof target === 'string') {
          return metadata.find(
            (meta) =>
              meta.className === target ||
              meta.collection === target ||
              meta.collection === target.toLowerCase(),
          );
        }
        return undefined;
      },
    };

    const generator = new Neo4jSchemaCypherGenerator();
    const structure = generator.convertToStructure({ getMetadata: () => metadataStorage } as any);
    const sdl = graphqlFormatter(structure);

    expect(sdl).toContain('interface DefineProduction');
    expect(sdl).toContain('actors: [DefinePerson!]! @declareRelationship');
    expect(sdl).toContain('type DefineMovie implements DefineProduction @node');
    expect(sdl).toContain('type DefineSeries implements DefineProduction @node');
    expect(sdl).toContain(
      'actors: [DefinePerson!]! @relationship(type: "ACTED_IN", direction: IN)',
    );
  });
});
