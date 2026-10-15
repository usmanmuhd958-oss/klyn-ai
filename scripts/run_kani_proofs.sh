#!/usr/bin/env bash
# Reproducible Kani proof runner with pinned verifier and preserved output.
set -Eeuo pipefail

fail() {
  printf 'KANI PROOFS FAILED: %s\n' "$*" >&2
  exit 1
}

[[ "$(uname -s)" == "Linux" ]] || fail "Kani verification requires Linux"
[[ "$(uname -m)" == "x86_64" ]] || fail "the pinned Kani release requires x86_64 Linux"
command -v cargo >/dev/null 2>&1 || fail "cargo is required"
command -v rustup >/dev/null 2>&1 || fail "rustup is required"

KANI_VERSION="${KANI_VERSION:-0.68.0}"
installed_version="$(cargo kani --version 2>/dev/null || true)"
if [[ "$installed_version" != *"$KANI_VERSION"* ]]; then
  cargo install --locked kani-verifier --version "$KANI_VERSION" --force
fi

cargo kani setup
cargo metadata --locked --format-version 1 >/dev/null
evidence_log="${KLYN_KANI_LOG:-target/kani-evidence/kani.log}"
mkdir -p "$(dirname "$evidence_log")"

{
  printf 'Kani verifier: %s\n' "$(cargo kani --version)"
  printf 'Rust toolchain: %s\n' "$(rustc --version)"
  printf 'Proof package: klyn-sandbox\n'
  printf 'Finite model unwind bound: 20\n'
} | tee "$(dirname "$evidence_log")/metadata.txt"

set +e
cargo kani --package klyn-sandbox --default-unwind 20 --output-format terse "$@" 2>&1 | tee "$evidence_log"
kani_status=${PIPESTATUS[0]}
set -e

if (( kani_status != 0 )); then
  fail "cargo kani exited with status $kani_status; see $evidence_log"
fi
printf 'KANI PROOFS PASSED: cargo kani returned zero; log=%s\n' "$evidence_log"
