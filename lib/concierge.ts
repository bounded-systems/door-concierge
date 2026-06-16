/**
 * concierge.ts — in-box client for concierged (the --concierge door).
 *
 * Service-oriented delegation, replacing lib/spawn.ts's role: a box does not
 * launch a child that inherits its doors — it is INTRODUCED to a capability.
 * Providers `register` what they serve; consumers `resolve` a capability and get
 * back an attenuated DoorGrant they then `call()` peer-to-peer.
 *
 * ⚠️ PHASE 1 — PLUMBING, NOT A BOUNDARY (CONCIERGE.md §9). The resolved grant is
 * routing data: a door means it's reachable, not that you're authorized. The
 * boundary is the serving room verifying a SIGNED grant (prx, Phase 2) — not yet
 * wired. Don't treat a Phase-1 resolve as a non-bypassable capability.
 *
 *   import { resolve } from "./lib/concierge";
 *   import { call } from "./guest-room/protocol.ts";
 *   const scout = await resolve("scout", ["host=github.com"]);
 *   const body  = await call(scout.guest, "fetch", { url: "https://api.github.com/…" });
 *
 * See CONCIERGE.md.
 */

import { call } from "../guest-room/protocol.ts";
import type { DoorGrant } from "../guest-room/mod.ts";

/** Resolve the concierge socket: $CONCIERGE_SOCK, else XDG runtime, else home. */
function conciergeSocket(): string {
  const envPath = process.env.CONCIERGE_SOCK;
  if (envPath) return envPath;
  const runtime = process.env.XDG_RUNTIME_DIR;
  if (runtime) return `${runtime}/concierged.sock`;
  const home = process.env.HOME ?? "/tmp";
  return `${home}/.claude-box/concierged.sock`;
}

export type RegisterOptions = {
  /** Logical capability name, e.g. "scout", "egress". */
  capability: string;
  /** Socket path this provider serves the capability on. */
  door: string;
  /** Env var name the consumer should bind the door to (default: <CAP>_SOCK). */
  env?: string;
  /** One-line description for the rulebook. */
  grants?: string;
  /** Ceiling caveats — the most authority this provider will ever hand out. */
  caveats?: string[];
  /** Lease TTL in seconds; re-register before expiry to stay discoverable. */
  lease?: number;
};

/** Announce a capability this box serves. Returns the granted lease TTL. */
export async function register(opts: RegisterOptions): Promise<{ ttl: number }> {
  return call<{ ttl: number }>(conciergeSocket(), "register", { ...opts });
}

/** Be introduced to a capability: the serving room's door, attenuated by `want`
 *  (only ever narrower than the provider's ceiling). Rejects if nothing live
 *  serves it. The returned DoorGrant's `guest` transport is what you call(). */
export async function resolve(capability: string, want: string[] = []): Promise<DoorGrant> {
  const { door } = await call<{ door: DoorGrant }>(conciergeSocket(), "resolve", { capability, want });
  return door;
}

export type CapabilityRow = { capability: string; grants: string; providers: number };

/** List the capabilities currently served (discovery/introspection). */
export async function list(): Promise<CapabilityRow[]> {
  const { capabilities } = await call<{ capabilities: CapabilityRow[] }>(conciergeSocket(), "list");
  return capabilities;
}
