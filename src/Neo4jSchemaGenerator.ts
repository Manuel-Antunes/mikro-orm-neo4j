import {
  type ClearDatabaseOptions,
  type CreateSchemaOptions,
  type DropSchemaOptions,
  type EnsureDatabaseOptions,
  type EntityManager,
  type ISchemaGenerator,
  type MikroORM,
  type RefreshDatabaseOptions,
  type UpdateSchemaOptions,
} from '@mikro-orm/core';
import graphqlFormatter from './graphql/graphql.js';
import { Neo4jSchemaCypherGenerator } from './graphql/Neo4jSchemaCypherGenerator.js';
import type { Neo4jDriver } from './Neo4jDriver.js';
import { Neo4jEntityManager } from './Neo4jEntityManager.js';

export class Neo4jSchemaGenerator implements ISchemaGenerator {
  private readonly driver: Neo4jDriver;

  constructor(private readonly em: EntityManager) {
    this.driver = this.em.getDriver() as Neo4jDriver;
  }

  static register(orm: MikroORM): void {
    orm.config.registerExtension(
      '@mikro-orm/schema-generator',
      () => new Neo4jSchemaGenerator(orm.em),
    );
  }

  async create(_options: CreateSchemaOptions = {}): Promise<void> {
    // Neo4j is schemaless for nodes/relationships; indexes can be added later
  }

  async update(_options: UpdateSchemaOptions = {}): Promise<void> {
    // noop for MVP
  }

  async drop(_options: DropSchemaOptions = {}): Promise<void> {
    // noop for MVP
  }

  async refresh(options: RefreshDatabaseOptions = {}): Promise<void> {
    await this.drop(options);
    await this.create(options);
  }

  async clear(_options: ClearDatabaseOptions = {}): Promise<void> {
    await this.driver.getConnection().execute('MATCH (n) DETACH DELETE n', {});
  }

  async execute(sql: string, _options?: { wrap?: boolean }): Promise<void> {
    await this.driver.getConnection().execute(sql, {});
  }

  async getCreateSchemaSQL(_options: CreateSchemaOptions = {}): Promise<string> {
    return '';
  }

  async getDropSchemaSQL(_options: Omit<DropSchemaOptions, 'dropDb'> = {}): Promise<string> {
    return '';
  }

  async getUpdateSchemaSQL(_options: UpdateSchemaOptions = {}): Promise<string> {
    return '';
  }

  async getUpdateSchemaMigrationSQL(_options: UpdateSchemaOptions = {}): Promise<{
    up: string;
    down: string;
  }> {
    return { up: '', down: '' };
  }

  async ensureDatabase(_options: EnsureDatabaseOptions = {}): Promise<boolean> {
    return true;
  }

  async createDatabase(_name?: string): Promise<void> {
    // noop for Neo4j in this driver
  }

  async dropDatabase(_name?: string): Promise<void> {
    // noop for Neo4j in this driver
  }

  async ensureIndexes(): Promise<void> {
    // noop for MVP
  }

  // Legacy aliases kept for backwards compatibility with existing tests/usages.
  async createSchema(options: CreateSchemaOptions = {}): Promise<void> {
    await this.create(options);
  }

  async updateSchema(options: UpdateSchemaOptions = {}): Promise<void> {
    await this.update(options);
  }

  async dropSchema(options: DropSchemaOptions = {}): Promise<void> {
    await this.drop(options);
  }

  async refreshDatabase(options: RefreshDatabaseOptions = {}): Promise<void> {
    await this.refresh(options);
  }

  async clearDatabase(options: ClearDatabaseOptions = {}): Promise<void> {
    await this.clear(options);
  }

  private sdlGen = new Neo4jSchemaCypherGenerator();
  getGraphSdl(readonly = false): string {
    return graphqlFormatter(
      this.sdlGen.convertToStructure(this.em as Neo4jEntityManager),
      readonly,
    );
  }
}
