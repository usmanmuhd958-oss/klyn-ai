#!/usr/bin/env bash
# Reproducible, bounded-memory cargo-fuzz campaign for the KLYN IPC and KEL parsers.
set -Eeuo pipefail

fail() {
  printf 'FUZZ CAMPAIGN FAILED: %s\n' "$*" >&2
  exit 1
}

command -v cargo >/dev/null 2>&1 || fail "cargo is required"
cargo fuzz --help >/dev/null 2>&1 || fail "install cargo-fuzz first: cargo install cargo-fuzz --locked"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fuzz_dir="$root/crates/klyn-sandbox/fuzz"
runs="${KLYN_FUZZ_RUNS:-1000000}"
[[ "$runs" =~ ^[1-9][0-9]*$ ]] || fail "KLYN_FUZZ_RUNS must be a positive integer"

cd "$fuzz_dir"
printf '== Build both fuzz targets ==\n'
cargo fuzz build fuzz_ipc_frame
cargo fuzz build fuzz_kel_parser

printf '\n== IPC frame/control parser: %s iterations ==\n' "$runs"
cargo fuzz run fuzz_ipc_frame -- -runs="$runs" -max_len=65540 -timeout=5

printf '\n== KEL record/chain verifier: %s iterations ==\n' "$runs"
cargo fuzz run fuzz_kel_parser -- -runs="$runs" -max_len=14752 -timeout=5

printf '\nFUZZ CAMPAIGN PASSED: both targets completed without a crash or timeout.\n'
