#!/usr/bin/env bash
# Mandatory native Linux qualification for KLYN's kernel enforcement boundary.
# Run as the dedicated, unprivileged KLYN daemon identity on an ephemeral host.
set -Eeuo pipefail

fail() {
  printf 'NATIVE QUALIFICATION FAILED: %s\n' "$*" >&2
  exit 1
}

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "required environment variable $name is unset"
}

[[ "$(uname -s)" == "Linux" ]] || fail "native qualification requires Linux"
[[ "$(id -u)" -ne 0 ]] || fail "do not run the daemon qualification as UID 0"

for name in \
  KLYN_TEST_CGROUP_ROOT KLYN_CGROUP_ROOT KLYN_REPOSITORY KLYN_FS_STATE_DIR \
  KLYN_DAEMON_SOCKET KLYN_POLICY_FILE KLYN_SIGNING_KEY_FILE KLYN_REVOCATION_FILE \
  KLYN_SANDBOX_INIT KLYN_WORKER_EXECUTABLE KLYN_READ_ONLY_ROOT KLYN_BROKER_DIR; do
  require_env "$name"
done

export KLYN_REQUIRE_NATIVE_LINUX_QUALIFICATION=1
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$PWD/target}"
if [[ "$CARGO_TARGET_DIR" != /* ]]; then
  export CARGO_TARGET_DIR="$PWD/$CARGO_TARGET_DIR"
fi

test_cgroup_root="$(realpath -e "$KLYN_TEST_CGROUP_ROOT")" || fail "KLYN_TEST_CGROUP_ROOT does not exist"
daemon_cgroup_root="$(realpath -e "$KLYN_CGROUP_ROOT")" || fail "KLYN_CGROUP_ROOT does not exist"
[[ "$test_cgroup_root" == "$daemon_cgroup_root" ]] || fail "test and daemon cgroup roots must be the same delegated directory"
[[ "$(stat -f -c %T "$test_cgroup_root")" == "cgroup2fs" ]] || fail "configured cgroup root is not on a cgroup v2 mount"
[[ -w "$test_cgroup_root" ]] || fail "delegated cgroup root is not writable by this daemon identity"
[[ -f "$test_cgroup_root/cgroup.controllers" && -f "$test_cgroup_root/cgroup.subtree_control" ]] || fail "delegated root lacks cgroup v2 controls"
[[ -f "$test_cgroup_root/cgroup.kill" ]] || fail "kernel does not expose cgroup.kill"
for controller in cpu memory pids; do
  grep -qw "$controller" "$test_cgroup_root/cgroup.controllers" || fail "cgroup controller $controller is unavailable"
  grep -qw "$controller" "$test_cgroup_root/cgroup.subtree_control" || fail "cgroup controller $controller is not enabled in cgroup.subtree_control"
done

git -C "$KLYN_REPOSITORY" rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "KLYN_REPOSITORY must be a disposable Git checkout"
[[ -z "$(git -C "$KLYN_REPOSITORY" status --porcelain --untracked-files=all)" ]] || fail "KLYN_REPOSITORY must be clean"
publication_ref="${KLYN_PUBLICATION_REF:-refs/heads/klyn-published}"
if git -C "$KLYN_REPOSITORY" show-ref --verify --quiet "$publication_ref"; then
  fail "publication ref $publication_ref already exists; use a fresh disposable clone"
fi
if [[ -d "$KLYN_FS_STATE_DIR" ]] && find "$KLYN_FS_STATE_DIR" -mindepth 1 -print -quit | grep -q .; then
  fail "KLYN_FS_STATE_DIR must be absent or empty; use fresh qualification state"
fi

# The worker trusts only this fixed, root-controlled public key path.
public_key=/etc/klyn/ocap-ed25519.pub
[[ -f "$public_key" && ! -L "$public_key" ]] || fail "$public_key must be provisioned before qualification"
[[ "$(stat -c %u "$public_key")" == "0" ]] || fail "$public_key must be root-owned"
[[ -r "$public_key" ]] || fail "$public_key must be readable by the non-root worker"
public_key_mode=$((8#$(stat -c %a "$public_key")))
(( (public_key_mode & 022) == 0 )) || fail "$public_key must not be group/world writable"
[[ "$(stat -c %s "$public_key")" == "32" ]] || fail "$public_key must contain exactly 32 raw Ed25519 public-key bytes"

printf '\n== Native KLYN qualification host ==\n'
uname -a
rustc --version
cargo --version
printf 'daemon uid/gid: %s/%s\n' "$(id -u)" "$(id -g)"
printf 'delegated cgroup root: %s\n' "$test_cgroup_root"

cargo fmt --all -- --check
cargo metadata --locked --format-version 1 >/dev/null
RUSTFLAGS="-D warnings" cargo check --locked --workspace --all-targets

# Mandatory mode makes the real cgroup probe fail rather than skip and
# requires Landlock ABI v8+ instead of accepting a fail-closed fallback.
cargo test --locked --workspace -- --nocapture --test-threads=1
RUSTFLAGS="-D warnings" cargo clippy --locked --workspace --all-targets -- -D warnings
cargo build --locked --workspace --bins

check_trusted_copy() {
  local built="$1"
  local installed="$2"
  [[ -f "$built" && -f "$installed" ]] || fail "missing built or installed executable: $built / $installed"
  cmp -s "$built" "$installed" || fail "installed trusted executable differs from this source revision: $installed"
  [[ "$(stat -c %u "$installed")" == "0" ]] || fail "trusted executable must be root-owned: $installed"
  local mode
  mode=$((8#$(stat -c %a "$installed")))
  (( (mode & 0111) != 0 )) || fail "trusted executable is not executable: $installed"
  (( (mode & 022) == 0 )) || fail "trusted executable is group/world writable: $installed"
  (( (mode & 06000) == 0 )) || fail "trusted executable must not be setuid/setgid: $installed"
}

check_trusted_copy "$CARGO_TARGET_DIR/debug/klyn-sandbox-init" "$KLYN_SANDBOX_INIT"
check_trusted_copy "$CARGO_TARGET_DIR/debug/klyn-worker" "$KLYN_WORKER_EXECUTABLE"

printf '\n== End-to-end worker smoke test ==\n'
# The installed helper needs its separately reviewed, narrowly scoped privilege
# setup. Any bootstrap or policy failure must make this command fail.
timeout 120s "$CARGO_TARGET_DIR/debug/klyn-daemon" --worker-smoke

printf '\nNATIVE QUALIFICATION PASSED: cgroup v2, mandatory Landlock/seccomp probes, gate tests, daemon worker smoke, and workspace quality gates.\n'
