import { GenericContainer, Network } from 'testcontainers';

export async function setupNeo4jContainer(
  auth: {
    username: string;
    password: string;
  } = {
    username: 'neo4j',
    password: 'test',
  },
  network: Network = new Network(),
) {
  const _network = await network.start();
  const authString = `${auth.username}/${auth.password}`;
  const neo4jContainer = await new GenericContainer('neo4j:5.25')
    .withNetwork(_network)
    .withNetworkAliases('neo4j')
    .withExposedPorts(7687)
    .withStartupTimeout(300_000)
    .withEnvironment({
      NEO4J_AUTH: authString,
      NEO4J_server_memory_heap_max__size: '2G',
    })
    .start();
  return {
    container: neo4jContainer,
    network: _network,
    connectionUri: `bolt://${neo4jContainer.getHost()}:${neo4jContainer.getMappedPort(7687)}`,
  };
}

export type StartedNeo4jContainer = Awaited<ReturnType<typeof setupNeo4jContainer>>;
