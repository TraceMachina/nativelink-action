{
  pkgs,
  pnpm,
  ...
}: let
  # Global excludes go here.
  excludes = [
    "badges/coverage.svg"
    "dist/.*"
  ];
in {
  # Default hooks
  trailing-whitespace-fixer = {
    inherit excludes;
    enable = true;
    name = "trailing-whitespace";
    description = "Remove trailing whitespace";
    entry = "${pkgs.python311Packages.pre-commit-hooks}/bin/trailing-whitespace-fixer";
    types = ["text"];
  };
  end-of-file-fixer = {
    inherit excludes;
    enable = true;
    name = "end-of-file-fixer";
    description = "Remove trailing whitespace";
    entry = "${pkgs.python311Packages.pre-commit-hooks}/bin/end-of-file-fixer";
    types = ["text"];
  };
  fix-byte-order-marker = {
    inherit excludes;
    enable = true;
    name = "fix-byte-order-marker";
    entry = "${pkgs.python311Packages.pre-commit-hooks}/bin/fix-byte-order-marker";
  };
  mixed-line-ending = {
    inherit excludes;
    enable = true;
    name = "mixed-line-ending";
    entry = "${pkgs.python311Packages.pre-commit-hooks}/bin/mixed-line-ending";
    types = ["text"];
  };
  check-case-conflict = {
    inherit excludes;
    enable = true;
    name = "check-case-conflict";
    entry = "${pkgs.python311Packages.pre-commit-hooks}/bin/check-case-conflict";
    types = ["text"];
  };
  detect-private-key = {
    inherit excludes;
    enable = true;
    name = "detect-private-key";
    entry = "${pkgs.python311Packages.pre-commit-hooks}/bin/detect-private-key";
    types = ["text"];
  };

  # Nix
  alejandra.enable = true;
  statix.enable = true;
  deadnix.enable = true;

  # prettier
  prettier = {
    description = "prettier";
    enable = true;
    entry = let
      script = pkgs.writeShellScript "precommit-prettier" ''
        set -xeuo pipefail
        if [ ! -d node_modules ]; then ${pnpm}/bin/pnpm install; fi
        ${pnpm}/bin/pnpm format:write
      '';
    in
      builtins.toString script;
    require_serial = true;
    pass_filenames = false;
  };

  actionlint = {
    description = "actionlint";
    enable = true;
    entry = let
      script = pkgs.writeShellScript "precommit-actionlint" ''
        set -xeuo pipefail
        ${pkgs.actionlint}/bin/actionlint --config-file actionlint.yml
      '';
    in
      builtins.toString script;
    require_serial = true;
    pass_filenames = false;
  };

  # json5
  formatjson5 = {
    description = "Format json5 files";
    enable = true;
    entry = "${pkgs.formatjson5}/bin/formatjson5";
    args = ["-r" "--indent" "2"];
    types = ["json5"];
  };

  # coverage
  coverage = {
    description = "coverage badge";
    enable = true;
    entry = let
      script = pkgs.writeShellScript "precommit-coverage" ''
        set -xeuo pipefail
        if [ ! -d node_modules ]; then ${pnpm}/bin/pnpm install; fi
        ${pnpm}/bin/pnpm test
        ${pnpm}/bin/pnpm coverage
      '';
    in
      builtins.toString script;
    require_serial = true;
    pass_filenames = false;
  };

  # dist
  dist = {
    description = "dist";
    enable = true;
    entry = let
      script = pkgs.writeShellScript "precommit-dist" ''
        set -xeuo pipefail
        if [ ! -d node_modules ]; then ${pnpm}/bin/pnpm install; fi
        ${pnpm}/bin/pnpm package
      '';
    in
      builtins.toString script;
    require_serial = true;
    pass_filenames = false;
  };
}
