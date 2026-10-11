#!/usr/bin/env bash
set -Eeuo pipefail

readonly REPOSITORY="https://github.com/usmanmuhd958-oss/klyn-ai.git"
readonly BRANCH="feat/klyn-step3-os-sandbox"
readonly DESTINATION="${HOME}/klyn"

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

command -v git >/dev/null 2>&1 || die "git is required. In Termux run: pkg install git"
command -v cargo >/dev/null 2>&1 || printf 'NOTE: Rust/Cargo are not installed; source sync will still proceed.\n' >&2

if [[ -e "$DESTINATION" && ! -d "$DESTINATION/.git" ]]; then
  die "$DESTINATION exists but is not a Git checkout. Move it aside yourself; this script will not overwrite it."
fi

if [[ ! -d "$DESTINATION/.git" ]]; then
  git clone --single-branch --branch "$BRANCH" "$REPOSITORY" "$DESTINATION"
else
  remote_url="$(git -C "$DESTINATION" remote get-url origin 2>/dev/null || true)"
  case "$remote_url" in
    "$REPOSITORY"|"https://github.com/usmanmuhd958-oss/klyn-ai"|"git@github.com:usmanmuhd958-oss/klyn-ai.git")
      ;;
    *)
      die "origin is '$remote_url', not the expected KLYN repository. No changes were made."
      ;;
  esac

  if [[ -n "$(git -C "$DESTINATION" status --porcelain --untracked-files=all)" ]]; then
    die "$DESTINATION has local changes. Commit or back them up, then rerun; this script will not discard them."
  fi

  git -C "$DESTINATION" fetch origin "$BRANCH"
  if git -C "$DESTINATION" show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git -C "$DESTINATION" switch "$BRANCH"
  else
    git -C "$DESTINATION" switch --track -c "$BRANCH" "origin/$BRANCH"
  fi
  git -C "$DESTINATION" pull --ff-only origin "$BRANCH"
fi

printf '\nKLYN Step 3 source synced.\n'
printf 'Directory: %s\n' "$DESTINATION"
printf 'Branch:    %s\n' "$BRANCH"
printf 'Commit:    %s\n' "$(git -C "$DESTINATION" rev-parse HEAD)"

platform="$(uname -o 2>/dev/null || uname -s 2>/dev/null || true)"
is_android=false
case "$platform" in
  Android|android) is_android=true ;;
esac
if [[ -n "${ANDROID_ROOT:-}" ]]; then is_android=true; fi
case "${PREFIX:-}" in
  *com.termux*) is_android=true ;;
esac
if command -v getprop >/dev/null 2>&1 && [[ -n "$(getprop ro.build.version.sdk 2>/dev/null || true)" ]]; then
  is_android=true
fi

if [[ "$is_android" == true ]]; then
  cat <<'EOF'

Android/Termux detected. The code is synced, but the OS sandbox cannot be
built/run as a native Android target: klyn-sandbox deliberately rejects
non-Linux targets, and Termux cannot assume user/mount/PID namespaces,
Landlock ABI v8, seccomp, or delegated cgroup v2 are available.

Do not treat cargo test in Termux as an OS-isolation test. On this device,
use the checkout for reading/editing and Rust formatting if installed.
Run the native build/tests on a dedicated Linux host/VM with the required
kernel features and an actually delegated cgroup-v2 subtree.
EOF
  if command -v cargo >/dev/null 2>&1; then
    if cargo fmt --all -- --check; then
      printf '\nRust formatting check passed.\n'
    else
      printf '\nNOTE: formatting check did not pass; no source files were changed by this script.\n' >&2
    fi
  fi
  exit 0
fi

command -v cargo >/dev/null 2>&1 || die "cargo is required on Linux to run verification"
cd "$DESTINATION"
cargo fmt --all -- --check
cargo test --package klyn-fs --package klyn-protocol --package klyn-daemon --package klyn-sandbox
cargo clippy --package klyn-fs --package klyn-protocol --package klyn-daemon --package klyn-sandbox --all-targets -- -D warnings
cargo build --release --package klyn-sandbox --bin klyn-worker-bootstrap --package klyn-daemon --bin klyn-daemon

printf '\nNative Linux verification and builds completed.\n'
printf 'Worker bootstrap: %s/target/release/klyn-worker-bootstrap\n' "$DESTINATION"
printf 'Daemon:           %s/target/release/klyn-daemon\n' "$DESTINATION"
printf 'The runtime smoke test still requires an actual delegated cgroup-v2 root and operator-owned config files; see docs/step3-worker-bootstrap.md.\n'
