# door-concierge — the capability-introducer door

`door-concierge` is **concierged** packaged as a standalone, pinned OCI image. concierged is an
**introducer**: it holds a leased registry and, on `resolve`, hands back *attenuated door
references* — pure routing. It never connects to a provider, so it holds **no NIC**
(`--network=none`) and needs no egress toolchain. It's the resolution piece of the
[claude-box](https://github.com/bounded-systems/claude-box) door model (write: door-keeper; egress:
door-net; read: door-scout).

## Build / run

```sh
nix build .#concierged-image && podman load -i result
podman run -v doors:/run/doors concierged
```

Tests: `tests/concierged.test.ts` + `tests/concierged.ocap.test.ts` (registry + caveat-attenuated
resolve).

## Pinned dependencies (vendored mirrors)

Each is a PINNED input and a generated mirror, kept honest by the `*-mirror` checks
(`nix flake check`):

| Dir | Pinned input | Bump |
|---|---|---|
| `lib/{runtime,concierge}.ts` | [`door-kit`](https://github.com/bounded-systems/door-kit) `@a3ae40e` | `nix flake update door-kit` + `nix run .#sync-door-kit` |
| `guest-room/` | [`guest-room`](https://github.com/bounded-systems/guest-room) `@5bc85b6` | `nix flake update guest-room` + `nix run .#sync-guest-room` |

_Extracted from claude-box `concierged.ts` — decomposition epic `prx-ii01`, card 2 (the last door)._
