// LX Desktop allows a 20-second script dispatch and up to 60 seconds per HTTP request.
// The enclosing dispatch signal still cancels pending HTTP requests at its deadline.
export const SOURCE_INIT_TIMEOUT = 15000;
export const SOURCE_REQUEST_TIMEOUT = 20000;
export const SOURCE_ATTEMPT_TIMEOUT = SOURCE_INIT_TIMEOUT + SOURCE_REQUEST_TIMEOUT + 15000;
export function sourceHttpTimeout(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(value, 60000) : 60000;
}
