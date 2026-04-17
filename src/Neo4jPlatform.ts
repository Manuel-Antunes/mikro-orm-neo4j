import {
  Platform,
  type Constructor,
  type EntityManager,
  type EntityProperty,
  type IPrimaryKey,
  type PopulateOptions,
  type Dictionary,
} from '@mikro-orm/core';
import { Neo4jExceptionConverter } from './Neo4jExceptionConverter.js';
import { Neo4jSchemaGenerator } from './Neo4jSchemaGenerator.js';
import { Neo4jEntityRepository } from './Neo4jEntityRepository.js';

export class Neo4jPlatform extends Platform {
  readonly supportsUuid = true;
  protected override readonly exceptionConverter = new Neo4jExceptionConverter();

  override usesImplicitTransactions(): boolean {
    return false;
  }

  override supportsTransactions(): boolean {
    return true;
  }

  override getRepositoryClass<_T extends object>(): Constructor<any> {
    return Neo4jEntityRepository as unknown as Constructor<any>;
  }

  override lookupExtensions(orm: any): void {
    Neo4jSchemaGenerator.register(orm);
  }

  override getExtension<T>(
    extensionName: string,
    extensionKey: string,
    moduleName: string,
    em: EntityManager,
  ): T {
    if (extensionName === 'EntityGenerator') {
      throw new Error('EntityGenerator is not supported for the Neo4j driver.');
    }

    /* istanbul ignore next */
    if (extensionName === 'Migrator') {
      throw new Error('Migrator is not supported for the Neo4j driver.');
    }

    return super.getExtension(extensionName, extensionKey, moduleName, em);
  }

  override getSchemaGenerator(driver: any, em?: EntityManager): Neo4jSchemaGenerator {
    return new Neo4jSchemaGenerator((em ?? driver) as any);
  }

  override normalizePrimaryKey<T extends number | string = string>(data: IPrimaryKey): T {
    return data as T;
  }

  override denormalizePrimaryKey(data: string | number): IPrimaryKey {
    return data;
  }

  getSerializedPrimaryKeyField(_field: string): string {
    return 'id';
  }

  usesDifferentSerializedPrimaryKey(): boolean {
    return false;
  }

  override isAllowedTopLevelOperator(operator: string): boolean {
    return ['$not'].includes(operator);
  }

  override shouldHaveColumn<T>(
    prop: EntityProperty<T>,
    populate: PopulateOptions<T>[],
    exclude?: string[],
  ): boolean {
    // Graph stores everything as properties on the node; collections are resolved separately
    if (super.shouldHaveColumn(prop, populate, exclude)) {
      return true;
    }

    return prop.kind !== undefined;
  }

  override cloneEmbeddable<T>(data: T): T {
    return data;
  }

  override convertsJsonAutomatically(): boolean {
    return true;
  }

  override convertJsonToDatabaseValue(value: unknown): unknown {
    return value as Dictionary;
  }

  override convertJsonToJSValue(value: unknown): unknown {
    return value;
  }
}
