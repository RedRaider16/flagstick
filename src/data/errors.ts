import type { Score } from '../domain/types'

export type ErrorKind = 'conflict' | 'forbidden' | 'invalid' | 'auth' | 'not_found' | 'network' | 'unknown'

export class AppError extends Error {
  constructor(
    message: string,
    readonly kind: ErrorKind,
    /** For conflicts on a score: the value now stored (null = the hole is empty). */
    readonly current?: Score | null,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message.replace(/^CONFLICT:\s*/, '')
  return String(e)
}
