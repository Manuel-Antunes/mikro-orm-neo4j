import {
  ExceptionConverter,
  type DriverException,
  UniqueConstraintViolationException,
  NotNullConstraintViolationException,
  SyntaxErrorException,
  ConstraintViolationException,
  DeadlockException,
  LockWaitTimeoutException,
  ConnectionException,
  ReadOnlyException,
  ServerException,
  type Dictionary,
} from '@mikro-orm/core';

// Neo4j error codes documented at https://neo4j.com/docs/status-codes/current/
export class Neo4jExceptionConverter extends ExceptionConverter {
  override convertException(exception: Error & Dictionary): DriverException {
    const code = exception.code as string | undefined;

    if (!code) {
      return super.convertException(exception);
    }

    if (
      code === 'Neo.ClientError.Schema.ConstraintValidationFailed' ||
      code === 'Neo.ClientError.Schema.IndexConstraintValidationFailed'
    ) {
      return new UniqueConstraintViolationException(exception);
    }

    if (code === 'Neo.ClientError.Schema.PropertyExistenceError') {
      return new NotNullConstraintViolationException(exception);
    }

    if (
      code === 'Neo.ClientError.Statement.SyntaxError' ||
      code === 'Neo.ClientError.Statement.ArgumentError' ||
      code === 'Neo.ClientError.Statement.ParameterMissing'
    ) {
      return new SyntaxErrorException(exception);
    }

    if (code === 'Neo.ClientError.Statement.ConstraintViolation') {
      return new ConstraintViolationException(exception);
    }

    if (
      code === 'Neo.TransientError.Transaction.DeadlockDetected' ||
      code === 'Neo.TransientError.Transaction.Outdated'
    ) {
      return new DeadlockException(exception);
    }

    if (
      code === 'Neo.TransientError.Transaction.LockClientStopped' ||
      code === 'Neo.TransientError.Transaction.LockWaitTimeout'
    ) {
      return new LockWaitTimeoutException(exception);
    }

    if (
      code === 'Neo.TransientError.Network.ConnectivityError' ||
      code === 'Neo.ClientError.Security.Unauthorized' ||
      code === 'Neo.ClientError.Security.Forbidden'
    ) {
      return new ConnectionException(exception);
    }
    if (code === 'Neo.ClientError.Statement.AccessMode') {
      return new ReadOnlyException(exception);
    }

    if (code.startsWith('Neo.DatabaseError.')) {
      return new ServerException(exception);
    }

    return super.convertException(exception);
  }
}
