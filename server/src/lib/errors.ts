/**
 * Einheitliche Fehlerstruktur. Jede Fehlerantwort hat:
 *   { error: <klare deutsche Meldung>, code: <stabiler Code>, detail?, ref? }
 * Unerwartete (500er) Fehler bekommen eine Referenz-ID, die auch im Server-Log steht —
 * so lässt sich ein Problem eindeutig zuordnen.
 */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public detail?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const Err = {
  badRequest: (message: string, detail?: unknown) => new AppError(400, 'BAD_REQUEST', message, detail),
  unauthorized: (message = 'Nicht angemeldet') => new AppError(401, 'UNAUTHORIZED', message),
  forbidden: (message = 'Keine Berechtigung') => new AppError(403, 'FORBIDDEN', message),
  notFound: (message = 'Nicht gefunden') => new AppError(404, 'NOT_FOUND', message),
  conflict: (message: string, detail?: unknown) => new AppError(409, 'CONFLICT', message, detail),
  unavailable: (message: string, detail?: unknown) => new AppError(503, 'UNAVAILABLE', message, detail),
}

/** Kurze, gut lesbare Referenz-ID für ein Log-Ereignis. */
export function newRef(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}
