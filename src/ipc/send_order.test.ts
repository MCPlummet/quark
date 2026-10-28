import { describe, it, expect } from "vitest";
import { inSendOrder } from "./send_order.js";

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("inSendOrder", () => {
  // A homeserver rate limit (Synapse: a burst of 10, then one every few
  // seconds) answers concurrent sends with 429s; each retried on its own, so
  // messages landed in whatever order their retries won.
  it("starts a room's next send only once the one before it has finished", async () => {
    const first = deferred<string>();
    const started: string[] = [];
    const a = inSendOrder("!r", () => { started.push("a"); return first.promise; });
    const b = inSendOrder("!r", async () => { started.push("b"); return "$b"; });
    await flush();
    expect(started).toEqual(["a"]);
    first.resolve("$a");
    expect(await a).toBe("$a");
    expect(await b).toBe("$b");
    expect(started).toEqual(["a", "b"]);
  });

  it("goes on to the next send after one fails, and hands the failure to its caller", async () => {
    const a = inSendOrder("!r", async () => { throw new Error("nope"); });
    const b = inSendOrder("!r", async () => "$b");
    await expect(a).rejects.toThrow("nope");
    expect(await b).toBe("$b");
  });

  it("does not hold one room's sends behind another's", async () => {
    const slow = deferred<string>();
    void inSendOrder("!slow", () => slow.promise);
    expect(await inSendOrder("!fast", async () => "$fast")).toBe("$fast");
    slow.resolve("$slow");
  });
});
