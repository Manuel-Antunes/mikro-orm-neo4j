import {
  UniqueConstraintViolationException,
  NotNullConstraintViolationException,
  SyntaxErrorException,
  ConstraintViolationException,
  DeadlockException,
  LockWaitTimeoutException,
  ConnectionException,
  ReadOnlyException,
  ServerException,
} from '@mikro-orm/core';
import { Neo4jExceptionConverter } from '../../src/Neo4jExceptionConverter.js';

describe('Neo4jExceptionConverter', () => {
  const converter = new Neo4jExceptionConverter();

  const wrapError = (code: string) => {
    const error = new Error('Neo4j Error') as any;
    error.code = code;
    return error;
  };

  test('UniqueConstraintViolationException', () => {
    const error1 = wrapError('Neo.ClientError.Schema.ConstraintValidationFailed');
    const error2 = wrapError('Neo.ClientError.Schema.IndexConstraintValidationFailed');
    expect(converter.convertException(error1)).toBeInstanceOf(UniqueConstraintViolationException);
    expect(converter.convertException(error2)).toBeInstanceOf(UniqueConstraintViolationException);
  });

  test('NotNullConstraintViolationException', () => {
    const error = wrapError('Neo.ClientError.Schema.PropertyExistenceError');
    expect(converter.convertException(error)).toBeInstanceOf(NotNullConstraintViolationException);
  });

  test('SyntaxErrorException', () => {
    const error1 = wrapError('Neo.ClientError.Statement.SyntaxError');
    const error2 = wrapError('Neo.ClientError.Statement.ArgumentError');
    const error3 = wrapError('Neo.ClientError.Statement.ParameterMissing');
    expect(converter.convertException(error1)).toBeInstanceOf(SyntaxErrorException);
    expect(converter.convertException(error2)).toBeInstanceOf(SyntaxErrorException);
    expect(converter.convertException(error3)).toBeInstanceOf(SyntaxErrorException);
  });

  test('ConstraintViolationException', () => {
    const error = wrapError('Neo.ClientError.Statement.ConstraintViolation');
    expect(converter.convertException(error)).toBeInstanceOf(ConstraintViolationException);
  });

  test('DeadlockException', () => {
    const error1 = wrapError('Neo.TransientError.Transaction.DeadlockDetected');
    const error2 = wrapError('Neo.TransientError.Transaction.Outdated');
    expect(converter.convertException(error1)).toBeInstanceOf(DeadlockException);
    expect(converter.convertException(error2)).toBeInstanceOf(DeadlockException);
  });

  test('LockWaitTimeoutException', () => {
    const error1 = wrapError('Neo.TransientError.Transaction.LockClientStopped');
    const error2 = wrapError('Neo.TransientError.Transaction.LockWaitTimeout');
    expect(converter.convertException(error1)).toBeInstanceOf(LockWaitTimeoutException);
    expect(converter.convertException(error2)).toBeInstanceOf(LockWaitTimeoutException);
  });

  test('ConnectionException', () => {
    const error1 = wrapError('Neo.TransientError.Network.ConnectivityError');
    const error2 = wrapError('Neo.ClientError.Security.Unauthorized');
    const error3 = wrapError('Neo.ClientError.Security.Forbidden');
    expect(converter.convertException(error1)).toBeInstanceOf(ConnectionException);
    expect(converter.convertException(error2)).toBeInstanceOf(ConnectionException);
    expect(converter.convertException(error3)).toBeInstanceOf(ConnectionException);
  });

  test('ReadOnlyException', () => {
    const error = wrapError('Neo.ClientError.Statement.AccessMode');
    expect(converter.convertException(error)).toBeInstanceOf(ReadOnlyException);
  });

  test('ServerException', () => {
    const error = wrapError('Neo.DatabaseError.General.UnknownError');
    expect(converter.convertException(error)).toBeInstanceOf(ServerException);
  });

  test('Default DriverException', () => {
    const error = wrapError('Unknown.Error.Code');
    expect(converter.convertException(error).constructor.name).toBe('DriverException');
  });

  test('Error without code', () => {
    const error = new Error('Generic Error') as any;
    expect(converter.convertException(error).constructor.name).toBe('DriverException');
  });
});
