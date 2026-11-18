import "server-only";

/** Matches a Postgres constraint error, also when the driver error is wrapped in a `cause`. */
export function violates(error: unknown, code: string, constraint: string) {
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth++) {
    const candidate = current as { code?: string; constraint?: string; cause?: unknown };
    if (candidate.code === code && candidate.constraint === constraint) return true;
    current = candidate.cause;
  }
  return false;
}

export const isUniqueViolation = (error: unknown, constraint: string) => violates(error, "23505", constraint);
