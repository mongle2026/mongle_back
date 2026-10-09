import { QueryFailedError } from 'typeorm';

// MySQL ER_DUP_ENTRY: unique 제약 위반
export function isDuplicateEntryError(error: unknown) {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { errno?: number } | undefined)?.errno === 1062
  );
}
