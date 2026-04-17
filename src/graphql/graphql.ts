/*
 * Copyright (c) "Neo4j"
 * Neo4j Sweden AB [http://neo4j.com]
 */

import type { Neo4jStruct, NodeMap, RelationshipMap } from './types';
import nodeKey from './utils/node-key';
import uniqueString from './utils/unique-string';
import { GraphQLNode } from './GraphQLNode';
import { NodeDirective } from './directives/Node';
import { RelationshipPropertiesDirective } from './directives/RelationshipProperties';
import createNodeFields from './utils/create-node-fields';
import createRelationshipFields from './utils/create-relationship-fields';
import generateGraphQLSafeName from './utils/generate-graphql-safe-name';
import generateRelationshipPropsName from './utils/generate-relationship-props-name';

type GraphQLNodeMap = {
  [key: string]: GraphQLNode;
};

export default function graphqlFormatter(neo4jStruct: Neo4jStruct, readonly = false): string {
  const { nodes, relationships } = neo4jStruct;
  const bareNodes = transformNodes(nodes);
  const withRelationships = hydrateWithRelationships(bareNodes, relationships);
  const sorted = Object.keys(withRelationships).sort((a, b) => {
    return withRelationships[a].typeName > withRelationships[b].typeName ? 1 : -1;
  });
  const sortedWithRelationships = sorted.map((typeName) => withRelationships[typeName].toString());
  if (readonly) {
    sortedWithRelationships.push('extend schema @mutation(operations: [])');
  }
  return sortedWithRelationships.join('\n\n');
}

function transformNodes(nodes: NodeMap): GraphQLNodeMap {
  const out = {};
  const takenTypeNames: string[] = [];
  Object.keys(nodes).forEach((nodeType) => {
    // No labels, skip
    if (!nodeType) {
      return;
    }
    const neo4jNode = nodes[nodeType];
    const neo4jNodeKey = nodeKey(neo4jNode.labels);
    const mainLabel = neo4jNode.labels[0] || nodeType.replace(/^:/, '');
    const typeName = neo4jNode.typeId || generateGraphQLSafeName(mainLabel);

    const uniqueTypeName = uniqueString(typeName, takenTypeNames);
    takenTypeNames.push(uniqueTypeName);
    const node = new GraphQLNode('type', uniqueTypeName, neo4jNode.description);

    if (neo4jNode.isNode) {
      const nodeDirective = new NodeDirective();
      // Omit labels if there is only one and it matches the type name
      if (neo4jNode.labels.length > 1 || mainLabel.toLowerCase() !== uniqueTypeName.toLowerCase()) {
        nodeDirective.addLabels(neo4jNode.labels);
      }
      node.addDirective(nodeDirective);
    }

    const fields = createNodeFields(neo4jNode.properties, node.typeName);
    fields.forEach((f) => node.addField(f));
    const key = neo4jNode.labels.length > 0 ? neo4jNodeKey : nodeType;
    (out as any)[key] = node;
  });
  return out;
}

function hydrateWithRelationships(nodes: GraphQLNodeMap, rels: RelationshipMap): GraphQLNodeMap {
  Object.entries(rels).forEach(([relKey, rel]) => {
    let relInterfaceName: string | undefined;

    if (rel.properties.length) {
      relInterfaceName = uniqueString(
        rel.propertiesTypeName || generateGraphQLSafeName(generateRelationshipPropsName(relKey)),
        Object.values(nodes).map((n) => n.typeName),
      );
      if (!nodes[relInterfaceName]) {
        const relTypeNode = new GraphQLNode('type', relInterfaceName, rel.description);
        relTypeNode.addDirective(new RelationshipPropertiesDirective());
        const relTypePropertiesFields = createNodeFields(rel.properties, relKey);
        relTypePropertiesFields.forEach((f) => relTypeNode.addField(f));
        nodes[relInterfaceName] = relTypeNode;
      }
    }
    rel.paths.forEach((path) => {
      const fromNode = nodes[path.fromTypeId];
      const toNode = nodes[path.toTypeId];

      if (!fromNode || !toNode) {
        return;
      }

      const { fromField, toField } = createRelationshipFields(
        fromNode.typeName,
        toNode.typeName,
        rel.type,
        relInterfaceName,
        path.fromFieldName,
        path.toFieldName,
      );

      if (
        path.fromFieldName &&
        fromField &&
        !fromNode.fields.some((f) => f.name === fromField.name)
      ) {
        fromNode.addField(fromField);
      }
      if (path.toFieldName && toField && !toNode.fields.some((f) => f.name === toField.name)) {
        toNode.addField(toField);
      }
    });
  });
  Object.keys(nodes).forEach((key) => {
    if (!nodes[key].fields.length) {
      delete nodes[key];
    }
  });
  return nodes;
}
