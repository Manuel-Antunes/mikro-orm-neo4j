import { MetadataStorage } from '@mikro-orm/core';

export function getMetadataFromDecorator(target: Function) {
  if (!Object.hasOwn(target, MetadataStorage.PATH_SYMBOL)) {
    Object.defineProperty(target, MetadataStorage.PATH_SYMBOL, {
      value: target.name,
      writable: true,
    });
  }

  return MetadataStorage.getMetadata(
    target.name,
    (target as Record<typeof MetadataStorage.PATH_SYMBOL, string>)[MetadataStorage.PATH_SYMBOL],
  );
}
