{ pkgs }: {
  deps = [
    pkgs.bash
    pkgs.python311
    pkgs.nodejs_20
    pkgs.jq
    pkgs.curl
    pkgs.coreutils
    pkgs.gnupg
    pkgs.sqlite
  ];
  shell = "${pkgs.bash}/bin/bash";
}
