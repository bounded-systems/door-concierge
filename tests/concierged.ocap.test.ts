/**
 * concierged OCAP proof — introduction hands back a NARROWED door whose caveats
 * are checkCaveats-shaped.
 *
 * Boots a real concierged listener, drives it with the in-box client
 * (lib/concierge), and asserts the Phase-1 introducer property: a resolved
 * capability comes back as a DoorGrant attenuated to the provider's ceiling (and
 * any narrowing the caller asked for), and those caveats are the shape
 * checkCaveats refuses out-of-ceiling requests over. The concierge itself never
 * sees the target's payload (introducer, not broker).
 *
 * Phase 1 (see CONCIERGE.md §9): this proves caveat *carriage* + attenuation,
 * NOT a verified, non-bypassable boundary. There is no serving room here (the
 * test plays both consumer and enforcer), no signature verify (prx-gated), and
 * the grant is a path reference — so reachability still bypasses the concierge.
 * "Don't claim non-bypassable introduction until Phase 2."
 *
 *   nix run nixpkgs#bun -- test tests/concierged.ocap.test.ts
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdirSync, unlinkSync } from "node:fs";
import { socketHandler, registry } from "../concierged.ts";
import { register, resolve } from "../lib/concierge.ts";
import { checkCaveats, type CaveatVerifiers } from "../guest-room/mod.ts";

const sockDir = `${process.env.HOME ?? "."}/.cache`;
const sockPath = `${sockDir}/cb-concierge-ocap-test.sock`;
let server: { stop: (c?: boolean) => void } | undefined;
let prevSock: string | undefined;

// A host verifier so we can prove the introduced door is enforceable.
const verifiers: CaveatVerifiers<{ hostname: string }> = {
  host: (value, ctx) =>
    value.split(",").map((s) => s.trim()).some((a) =>
      a.startsWith(".") ? ctx.hostname === a.slice(1) || ctx.hostname.endsWith(a) : ctx.hostname === a),
};

beforeAll(() => {
  mkdirSync(sockDir, { recursive: true });
  try { unlinkSync(sockPath); } catch { /* not present */ }
  server = Bun.listen({ unix: sockPath, socket: socketHandler }) as unknown as { stop: (c?: boolean) => void };
  prevSock = process.env.CONCIERGE_SOCK;
  process.env.CONCIERGE_SOCK = sockPath;
});

afterAll(() => {
  server?.stop(true);
  if (prevSock === undefined) delete process.env.CONCIERGE_SOCK;
  else process.env.CONCIERGE_SOCK = prevSock;
  try { unlinkSync(sockPath); } catch { /* gone */ }
});

beforeEach(() => {
  registry.length = 0;
});

describe("concierged OCAP proof (live introducer)", () => {
  test("register → resolve roundtrips the provider's door over the socket", async () => {
    await register({ capability: "scout", door: "/run/scoutd.sock", env: "SCOUTD_SOCK", grants: "external reads", caveats: ["host=github.com,.github.com"] });
    const door = await resolve("scout");
    expect(door.name).toBe("scout");
    expect(door.guest).toEqual({ kind: "unix", path: "/run/scoutd.sock" });
    expect(door.env).toBe("SCOUTD_SOCK");
  });

  test("the introduced door's caveats are CHECKABLE — out-of-ceiling host is refused by checkCaveats", async () => {
    await register({ capability: "scout", door: "/run/scoutd.sock", caveats: ["host=github.com,.github.com"] });
    const door = await resolve("scout");
    // Phase 1: no serving room and no signature verify here — this proves the grant
    // CARRIES enforceable caveats, not non-bypassable introduction (CONCIERGE.md §9).
    // At runtime the target broker (scoutd) is what would run this check on each call.
    expect(checkCaveats(door, { hostname: "api.github.com" }, verifiers).ok).toBe(true);
    expect(checkCaveats(door, { hostname: "evil.com" }, verifiers).ok).toBe(false);
  });

  test("want narrows the introduction further (never wider than the ceiling)", async () => {
    await register({ capability: "scout", door: "/run/scoutd.sock", caveats: ["host=github.com,.github.com"] });
    const door = await resolve("scout", ["mode=readonly"]);
    expect(door.caveats).toEqual(["host=github.com,.github.com", "mode=readonly"]);
  });

  test("resolving an unregistered capability is refused (fail closed)", async () => {
    await expect(resolve("nonexistent")).rejects.toThrow();
  });
});
