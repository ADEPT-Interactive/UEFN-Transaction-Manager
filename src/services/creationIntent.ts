/**
 * Creation requests are explicit workflow events. A request id that has
 * already been observed must not be replayed when a presentation component
 * remounts for a different workspace view.
 */
export function isNewCreationRequest(request: number, lastConsumedRequest: number): boolean {
  return Number.isSafeInteger(request) && request > lastConsumedRequest;
}
