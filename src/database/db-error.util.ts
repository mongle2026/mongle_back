import { QueryFailedError } from 'typeorm';

// PostgreSQL unique_violation(23505): unique 제약 위반
export function isDuplicateEntryError(error: unknown) {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string } | undefined)?.code === '23505'
  );
}
