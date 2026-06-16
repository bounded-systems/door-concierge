/**
 * concierged tests — unit tests for the capability concierge (register/resolve).
 *
 * Drives the daemon's handleRequest in-process (no socket). Lease-expiry is
 * covered in the engine (resolveProvider); here we test the daemon surface:
 * register/resolve roundtrip, attenuation on introduction, fail-closed resolve.
 *
 *   nix run nixpkgs#bun -- test tests/concierged.test.ts
 */
import { test, expect, describe, beforeEach } from "bun:test";
import { handleRequest, registry } from "../concierged.ts";

const rpc = async (method: string, params: Record<string, unknown> = {}) =>
  handleRequest(JSON.stringify({ id: "t", method, params }));

beforeEach(() => {
  registry.length = 0; // isolate the mutable registry between tests
});

describe("concierged register/resolve", () => {
  test("register then resolve returns the provider's door", async () => {
    await rpc("register", { capability: "scout", door: "/run/scoutd.sock", env: "SCOUTD_SOCK", grants: "external reads" });
    const resp = await rpc("resolve", { capability: "scout" });
    expect(resp.ok).toBe(true);
    const grant = (resp.result as { door: { name: string; guest: { path: string }; grants: string } }).door;
    expect(grant.name).toBe("scout");
    expect(grant.guest.path).toBe("/run/scoutd.sock");
    expect(grant.grants).toBe("external reads");
  });

  test("resolve of an unregistered capability fails closed", async () => {
    const resp = await rpc("resolve", { capability: "nope" });
    expect(resp.ok).toBe(false);
    expect(resp.error?.code).toBe("CAPABILITY_UNAVAILABLE");
  });

  test("PHASE 1: resolve carries an unsigned binding (sig null) — not a boundary yet", async () => {
    await rpc("register", { capability: "scout", door: "/run/scoutd.sock" });
    const resp = await rpc("resolve", { capability: "scout", audience: "box-42" });
    const binding = (resp.result as { binding: { audience: string; exp: number; nonce: string; sig: null } }).binding;
    expect(binding.sig).toBeNull(); // prx signs in Phase 2; until then nothing verifies
    expect(binding.audience).toBe("box-42");
    expect(typeof binding.exp).toBe("number");
    expect(typeof binding.nonce).toBe("string");
  });

  test("resolve attenuates by the caller's want, never wider than the ceiling", async () => {
    await rpc("register", { capability: "scout", door: "/run/scoutd.sock", caveats: ["host=github.com"] });
    const resp = await rpc("resolve", { capability: "scout", want: ["mode=readonly"] });
    const grant = (resp.result as { door: { caveats: string[] } }).door;
    expect(grant.caveats).toEqual(["host=github.com", "mode=readonly"]); // ceiling kept + want appended
  });

  test("register requires a valid capability name and a door", async () => {
    expect((await rpc("register", { door: "/x.sock" })).error?.code).toBe("INVALID_CAPABILITY");
    expect((await rpc("register", { capability: "scout" })).error?.code).toBe("INVALID_PARAMS");
  });

  test("re-registering the same capability+socket is a heartbeat, not a duplicate", async () => {
    await rpc("register", { capability: "scout", door: "/run/scoutd.sock", lease: 60 });
    await rpc("register", { capability: "scout", door: "/run/scoutd.sock", lease: 60 });
    const resp = await rpc("list");
    const caps = (resp.result as { capabilities: { capability: string; grants: string; providers: number }[] }).capabilities;
    expect(caps).toEqual([{ capability: "scout", grants: 'service "scout"', providers: 1 }]);
  });

  test("two providers for one capability both register (daemon may pick/round-robin)", async () => {
    await rpc("register", { capability: "scout", door: "/run/scout-a.sock" });
    await rpc("register", { capability: "scout", door: "/run/scout-b.sock" });
    const caps = ((await rpc("list")).result as { capabilities: { providers: number }[] }).capabilities;
    expect(caps[0]!.providers).toBe(2);
  });
});
