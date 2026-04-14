import {
  defineConfig,
  MikroORM,
  type AnyEntity,
  type EntityClass,
  type EntitySchema,
  type EntityManager,
  type EntityManagerType,
  type IDatabaseDriver,
  type Options,
} from '@mikro-orm/core';
import { Neo4jDriver } from './Neo4jDriver';
import type { Neo4jEntityManager } from './Neo4jEntityManager';

export type Neo4jOptions<
  EM extends Neo4jEntityManager = Neo4jEntityManager,
  Entities extends (string | EntityClass<AnyEntity> | EntitySchema)[] = (
    | string
    | EntityClass<AnyEntity>
    | EntitySchema
  )[],
> = Partial<Options<Neo4jDriver, EM, Entities>>;

export class Neo4jMikroORM<
  EM extends Neo4jEntityManager = Neo4jEntityManager,
  Entities extends (string | EntityClass<AnyEntity> | EntitySchema)[] = (
    | string
    | EntityClass<AnyEntity>
    | EntitySchema
  )[],
> extends MikroORM<Neo4jDriver, EM, Entities> {
  static override async init<
    D extends IDatabaseDriver = Neo4jDriver,
    EM extends EntityManager<D> = D[typeof EntityManagerType] & EntityManager<D>,
    Entities extends (string | EntityClass<AnyEntity> | EntitySchema)[] = (
      | string
      | EntityClass<AnyEntity>
      | EntitySchema
    )[],
  >(options: Partial<Options<D, EM, Entities>>): Promise<MikroORM<D, EM, Entities>> {
    return super.init(
      defineConfig({
        ...(options as Partial<Options<D, EM, Entities>>),
        driver: Neo4jDriver as unknown as Options<D, EM, Entities>['driver'],
      }),
    );
  }

  constructor(options: Partial<Options<Neo4jDriver, EM, Entities>>) {
    super(defineNeo4jConfig(options));
  }
}

/* istanbul ignore next */
export function defineNeo4jConfig<
  EM extends Neo4jEntityManager = Neo4jEntityManager,
  Entities extends (string | EntityClass<AnyEntity> | EntitySchema)[] = (
    | string
    | EntityClass<AnyEntity>
    | EntitySchema
  )[],
>(
  options: Partial<Options<Neo4jDriver, EM, Entities>>,
): Partial<Options<Neo4jDriver, EM, Entities>> {
  return defineConfig({ driver: Neo4jDriver, ...options });
}
