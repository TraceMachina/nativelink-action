{
  description = "nativelink-action";

  inputs = {
    # This flake follows the packages from the open-source nativelink
    # repository to keep local packages in sync. When making changes, manually
    # verify the flake.lock file to ensure that we don't introduce duplicate
    # versions.
    nativelink.url = "github:TraceMachina/nativelink";
    nixpkgs.follows = "nativelink/nixpkgs";
    flake-parts.follows = "nativelink/flake-parts";
    git-hooks.follows = "nativelink/git-hooks";
    flake-root.url = "github:srid/flake-root";
  };

  outputs = inputs @ {
    self,
    flake-parts,
    flake-root,
    ...
  }:
    flake-parts.lib.mkFlake {inherit inputs;} {
      systems = [
        "x86_64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      imports = [inputs.git-hooks.flakeModule inputs.flake-root.flakeModule];
      perSystem = {
        config,
        pkgs,
        system,
        ...
      }: {
        _module.args.pkgs = import self.inputs.nixpkgs {
          inherit system;
          overlays = [
          ];
        };
        pre-commit.settings = {
          hooks = import ./tools/pre-commit-hooks.nix {
            inherit pkgs;
            flake-root = config.flake-root.package;
            pnpm = pkgs.pnpm.override {
              nodejs = pkgs.nodejs_24;
            };
          };
        };
        devShells.default = pkgs.mkShell {
          buildInputs = [pkgs.bashInteractive]; # See https://discourse.nixos.org/t/non-interactive-bash-errors-from-flake-nix-mkshell/33310/4
          nativeBuildInputs = let
            pnpm = pkgs.pnpm.override {
              nodejs = pkgs.nodejs_24;
            };
          in [
            # Development tooling.
            pkgs.git
            pkgs.pre-commit
            pkgs.nodejs_24
            pnpm
            pkgs.actionlint
          ];
          shellHook = ''
            export SHELL=${pkgs.bashInteractive}/bin/bash
            # Generate the .pre-commit-config.yaml symlink when entering the
            # development shell.
            ${config.pre-commit.installationScript}
          '';
        };
      };
    };
}
