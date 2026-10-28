// Outgoing messages leave one at a time per room, in the order they were sent.
//
// Every send used to go out as soon as it was made, so several in flight at
// once was normal for anyone typing quickly. A homeserver rate limit then
// scrambled them: Synapse allows a burst of ten events and one every few
// seconds after that, answering the rest with 429s that matrix-sdk retries
// each on its own schedule — so they landed in whatever order their retries
// won, minutes late, and a thread read back as "1…11, 13, 17, 15, asdf, 18".
// Queued, the eleventh waits for the tenth and they land as typed.

/** The last send queued for each room, settled either way. */
const tails = new Map<string, Promise<unknown>>();

/**
 * Run `send` once every send queued for `roomId` before it has finished,
 * successfully or not. Resolves or rejects with `send`'s own outcome; a failed
 * send does not hold back the ones after it. Rooms do not wait on each other.
 */
export function inSendOrder<T>(roomId: string, send: () => Promise<T>): Promise<T> {
  const run = (tails.get(roomId) ?? Promise.resolve()).then(send);
  const tail = run.catch(() => undefined);
  tails.set(roomId, tail);
  void tail.then(() => {
    if (tails.get(roomId) === tail) tails.delete(roomId);
  });
  return run;
}
