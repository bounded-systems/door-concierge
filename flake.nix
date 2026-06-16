{
  # door-concierge — the capability concierge (concierged) as a pinned OCI image.
  #
  # Extracted from claude-box (epic prx-ii01, card 2). concierged is an INTRODUCER:
  # it holds a leased registry and hands back attenuated door references on
  # `resolve`. Pure routing — it never connects to a provider, so it holds NO NIC
  # (--network=none) and needs no egress toolchain (no socat/cacert), only the
  # /run/doors volume. claude-box (the integrator) pins the published image.
  description = "door-concierge — the concierged capability-introducer door as a pinned OCI image";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/9f11f828c213641c2369a9f1fa31fe31557e3156";

  inputs.guest-room.url = "github:bounded-systems/guest-room/5bc85b634a0a8d698243ba3b708f0420516308ec";
  inputs.guest-room.flake = false;
  inputs.door-kit.url = "github:bounded-systems/door-kit/a3ae40e5075e3dbded3db9a0d345f842984a646b";
  inputs.door-kit.flake = false;

  outputs = { self, nixpkgs, guest-room, door-kit }:
    let
      systems = [ "aarch64-linux" "x86_64-linux" ];
      forEach = nixpkgs.lib.genAttrs systems;
      pkgsFor = system: import nixpkgs { inherit system; };
      uid = 1000;
    in
    {
      packages = forEach (system:
        let pkgs = pkgsFor system;
        in {
          # concierged-image — the capability concierge as a container.
          #   nix build .#concierged-image && podman load -i result
          #   podman run -v doors:/run/doors concierged
          concierged-image =
            let
              conciergedTools = with pkgs; [ bun coreutils bashInteractive ];

              conciergedEnv = pkgs.buildEnv {
                name = "concierged-image-root";
                paths = conciergedTools;
                pathsToLink = [ "/bin" "/etc" "/share" "/lib" ];
              };

              conciergedSrc = pkgs.runCommand "concierged-src" { } ''
                mkdir -p $out/app/lib $out/app/guest-room
                cp ${./concierged.ts} $out/app/concierged.ts
                cp ${./lib/runtime.ts} $out/app/lib/runtime.ts
                cp ${./guest-room/mod.ts} $out/app/guest-room/mod.ts
                cp ${./guest-room/daemon.ts} $out/app/guest-room/daemon.ts
                cp ${./guest-room/protocol.ts} $out/app/guest-room/protocol.ts
              '';

              conciergedEntrypoint = pkgs.writeShellScript "concierged-entrypoint" ''
                exec bun /app/concierged.ts serve --socket /run/doors/concierged.sock "$@"
              '';
            in
            pkgs.dockerTools.buildLayeredImage {
              name = "concierged";
              tag = "dev";

              contents = [ conciergedEnv conciergedSrc ];

              extraCommands = ''
                mkdir -p etc tmp run/doors
                chmod 1777 tmp
                cat > etc/passwd <<EOF
                root:x:0:0:root:/root:/bin/bash
                concierge:x:${toString uid}:${toString uid}:concierge:/app:/bin/bash
                EOF
                cat > etc/group <<EOF
                root:x:0:
                concierge:x:${toString uid}:
                EOF
              '';

              fakeRootCommands = ''
                chown -R ${toString uid}:${toString uid} run/doors
              '';

              config = {
                Entrypoint = [ "${conciergedEntrypoint}" ];
                WorkingDir = "/app";
                User = "concierge";
                Env = [
                  "HOME=/app"
                  "PATH=/bin"
                  "LANG=C.UTF-8"
                ];
                Volumes = {
                  "/run/doors" = { };
                };
              };
            };

          default = self.packages.${system}.concierged-image;
        });

      # ── sync apps (regenerate the vendored mirrors from the pinned inputs) ──
      apps.aarch64-darwin =
        let pkgs = pkgsFor "aarch64-darwin";
        in {
          sync-guest-room = {
            type = "app";
            program = "${pkgs.writeShellScriptBin "sync-guest-room" ''
              set -euo pipefail
              for f in mod.ts daemon.ts protocol.ts; do
                install -m 644 ${guest-room}/$f "$PWD/guest-room/$f"; echo "synced guest-room/$f"
              done
            ''}/bin/sync-guest-room";
            meta.description = "Sync ./guest-room/ from the pinned guest-room input";
          };
          sync-door-kit = {
            type = "app";
            program = "${pkgs.writeShellScriptBin "sync-door-kit" ''
              set -euo pipefail
              for f in runtime.ts concierge.ts; do
                install -m 644 ${door-kit}/lib/$f "$PWD/lib/$f"; echo "synced lib/$f"
              done
            ''}/bin/sync-door-kit";
            meta.description = "Sync ./lib/ from the pinned door-kit input";
          };
        };

      # ── mirror checks: the vendored dirs must match the pinned inputs ──
      checks.aarch64-darwin =
        let pkgs = pkgsFor "aarch64-darwin";
        in {
          guest-room-mirror = pkgs.runCommand "guest-room-mirror" { } ''
            for f in mod.ts daemon.ts protocol.ts; do
              if ! diff -u ${guest-room}/$f ${./guest-room}/$f; then
                echo "guest-room/$f drifted — run: nix run .#sync-guest-room" >&2; exit 1
              fi
            done
            touch $out
          '';
          door-kit-mirror = pkgs.runCommand "door-kit-mirror" { } ''
            for f in runtime.ts concierge.ts; do
              if ! diff -u ${door-kit}/lib/$f ${./lib}/$f; then
                echo "lib/$f drifted — run: nix run .#sync-door-kit" >&2; exit 1
              fi
            done
            touch $out
          '';
        };
    };
}
