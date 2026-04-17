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
import { Neo4jDriver } from './Neo4jDriver.js';
import type { Neo4jEntityManager } from './Neo4jEntityManager.js';

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
    return super.init(defineNeo4jConfig(options as any) as any);
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
  const customOptions = { ...options };
  const userOnMetadata = customOptions.discovery?.onMetadata;

  customOptions.discovery = {
    ...customOptions.discovery,
    onMetadata: (meta: any, platform: any) => {
      // Fix mappedBy and owner clash for Neo4j relationships.
      // If a user passes mappedBy as the second argument to @ManyToMany but also specifies owner: true,
      // MikroORM throws because it treats both sides as owning. We convert mappedBy to inversedBy.
      Object.values(meta.properties).forEach((prop: any) => {
        if (prop.mappedBy && prop.owner) {
          prop.inversedBy = prop.mappedBy;
          delete prop.mappedBy;
        }
      });

      if (userOnMetadata) {
        userOnMetadata(meta, platform);
      }
    },
  };

  return defineConfig({ driver: Neo4jDriver, ...customOptions });
}
