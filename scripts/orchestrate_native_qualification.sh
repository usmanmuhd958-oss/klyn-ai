#!/usr/bin/env bash
# Trusted native Linux qualification orchestrator for a disposable VM runner.
# The readiness/ephemeral flags are provisioner attestations, not user inputs.
set -Eeuo pipefail

fail() {
  printf 'NATIVE ORCHESTRATION FAILED: %s\n' "$*" >&2
  exit 1
}
require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "required environment variable $name is unset"
}

[[ "${KLYN_NATIVE_QUALIFICATION_READY:-false}" == "true" ]] ||
  fail "KLYN_NATIVE_QUALIFICATION_READY must be exactly 'true'; provision the dedicated runner and trusted assets first"
[[ "${KLYN_NATIVE_EPHEMERAL_VM:-false}" == "true" ]] ||
  fail "KLYN_NATIVE_EPHEMERAL_VM must be exactly 'true'; this job is allowed only on a provisioner-attested disposable VM"
[[ "$(uname -s)" == "Linux" ]] || fail "native qualification requires Linux"
[[ "$(id -u)" -ne 0 ]] || fail "run as the dedicated unprivileged daemon identity, not UID 0"

for name in \
  KLYN_TEST_CGROUP_ROOT KLYN_CGROUP_ROOT KLYN_REPOSITORY KLYN_FS_STATE_DIR \
  KLYN_DAEMON_SOCKET KLYN_POLICY_FILE KLYN_SIGNING_KEY_FILE KLYN_REVOCATION_FILE \
  KLYN_SANDBOX_INIT KLYN_WORKER_EXECUTABLE KLYN_READ_ONLY_ROOT KLYN_BROKER_DIR \
  KLYN_EBPF_OBJECT; do
  require_env "$name"
done

repository_real="$(realpath -e "$KLYN_REPOSITORY")" || fail "KLYN_REPOSITORY does not exist"
working_tree_real="$(realpath -e "$PWD")" || fail "cannot resolve current working directory"
[[ "$repository_real" == "$working_tree_real" ]] ||
  fail "run the orchestrator from KLYN_REPOSITORY (repository=$repository_real cwd=$working_tree_real)"
git -C "$repository_real" rev-parse --is-inside-work-tree >/dev/null 2>&1 ||
  fail "KLYN_REPOSITORY must be a disposable Git checkout"

command -v cc >/dev/null 2>&1 || fail "a C compiler is required for the kernel Landlock ABI probe"
command -v bpftool >/dev/null 2>&1 || fail "bpftool is required for BTF validation"
command -v readelf >/dev/null 2>&1 || fail "readelf is required to inspect the eBPF ELF object"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required for evidence"
[[ -r /sys/kernel/btf/vmlinux ]] || fail "kernel BTF is unavailable at /sys/kernel/btf/vmlinux"
bpftool btf dump file /sys/kernel/btf/vmlinux format raw >/dev/null ||
  fail "bpftool cannot parse /sys/kernel/btf/vmlinux"
[[ -f "$KLYN_EBPF_OBJECT" && -r "$KLYN_EBPF_OBJECT" ]] ||
  fail "KLYN_EBPF_OBJECT must be a readable compiled CO-RE BPF object"
readelf -h "$KLYN_EBPF_OBJECT" | grep -Eq 'Machine:[[:space:]]+Linux BPF' ||
  fail "KLYN_EBPF_OBJECT is not an ELF object with EM_BPF machine type"

test_cgroup_root="$(realpath -e "$KLYN_TEST_CGROUP_ROOT")" ||
  fail "KLYN_TEST_CGROUP_ROOT does not exist"
daemon_cgroup_root="$(realpath -e "$KLYN_CGROUP_ROOT")" ||
  fail "KLYN_CGROUP_ROOT does not exist"
[[ "$test_cgroup_root" == "$daemon_cgroup_root" ]] ||
  fail "KLYN_TEST_CGROUP_ROOT and KLYN_CGROUP_ROOT must resolve to the same delegated directory"
[[ "$(stat -f -c %T "$test_cgroup_root")" == "cgroup2fs" ]] ||
  fail "configured cgroup root is not mounted as cgroup v2"
[[ -w "$test_cgroup_root" ]] || fail "delegated cgroup root is not writable by this daemon identity"
[[ -f "$test_cgroup_root/cgroup.controllers" && -f "$test_cgroup_root/cgroup.subtree_control" ]] ||
  fail "delegated root lacks cgroup-v2 controller files"
[[ -f "$test_cgroup_root/cgroup.kill" ]] || fail "kernel lacks cgroup.kill; authoritative teardown cannot be verified"
for controller in cpu memory pids; do
  grep -qw "$controller" "$test_cgroup_root/cgroup.controllers" ||
    fail "required cgroup-v2 controller '$controller' is not available"
  grep -qw "$controller" "$test_cgroup_root/cgroup.subtree_control" ||
    fail "required cgroup-v2 controller '$controller' is not enabled for descendants"
done

# Query the live kernel ABI, rather than inferring it from the installed headers
# or accepting the Rust runtime's fail-closed fallback as qualification.
evidence_root="${KLYN_NATIVE_EVIDENCE_ROOT:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}}"
evidence_dir="$evidence_root/klyn-native-qualification-${GITHUB_RUN_ID:-${CI_PIPELINE_ID:-local}}-$$"
umask 077
mkdir -p "$evidence_dir"
chmod 0700 "$evidence_dir"
landlock_probe_c="$evidence_dir/landlock_abi_probe.c"
landlock_probe="$evidence_dir/landlock_abi_probe"
cat > "$landlock_probe_c" <<'C_SOURCE'
#define _GNU_SOURCE
#include <errno.h>
#include <stdio.h>
#include <unistd.h>
#include <sys/syscall.h>
#ifndef LANDLOCK_CREATE_RULESET_VERSION
#define LANDLOCK_CREATE_RULESET_VERSION 1
#endif
int main(void) {
#ifndef SYS_landlock_create_ruleset
#error "SYS_landlock_create_ruleset is unavailable in the system headers"
#endif
    long abi = syscall(SYS_landlock_create_ruleset, NULL, 0,
                       LANDLOCK_CREATE_RULESET_VERSION);
    if (abi < 0) {
        perror("landlock_create_ruleset(VERSION)");
        return 2;
    }
    printf("%ld\n", abi);
    return 0;
}
C_SOURCE
cc -std=c11 -O2 -Wall -Wextra -Werror "$landlock_probe_c" -o "$landlock_probe" ||
  fail "could not compile the Landlock ABI probe"
landlock_abi="$("$landlock_probe")" || fail "live Landlock ABI query failed"
[[ "$landlock_abi" =~ ^[0-9]+$ ]] || fail "Landlock ABI query returned an invalid value: $landlock_abi"
(( landlock_abi >= 8 )) || fail "kernel reports Landlock ABI $landlock_abi; ABI v8 or newer is mandatory"

export KLYN_REQUIRE_NATIVE_LINUX_QUALIFICATION=1
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$PWD/target}"
if [[ "$CARGO_TARGET_DIR" != /* ]]; then
  export CARGO_TARGET_DIR="$PWD/$CARGO_TARGET_DIR"
fi

{
  printf 'KLYN_NATIVE_QUALIFICATION_READY=true\n'
  printf 'KLYN_NATIVE_EPHEMERAL_VM=true\n'
  printf 'commit=%s\n' "$(git -C "$KLYN_REPOSITORY" rev-parse HEAD)"
  printf 'kernel=%s\n' "$(uname -a)"
  printf 'uid_gid=%s/%s\n' "$(id -u)" "$(id -g)"
  printf 'landlock_abi=%s\n' "$landlock_abi"
  printf 'cgroup_root=%s\n' "$test_cgroup_root"
  printf 'cgroup_controllers=%s\n' "$(cat "$test_cgroup_root/cgroup.controllers")"
  printf 'cgroup_subtree_control=%s\n' "$(cat "$test_cgroup_root/cgroup.subtree_control")"
  printf 'cgroup_kill=present\n'
  printf 'kernel_btf_sha256=%s\n' "$(sha256sum /sys/kernel/btf/vmlinux | awk '{print $1}')"
  printf 'ebpf_object=%s\n' "$(realpath -e "$KLYN_EBPF_OBJECT")"
  printf 'ebpf_object_sha256=%s\n' "$(sha256sum "$KLYN_EBPF_OBJECT" | awk '{print $1}')"
  printf 'rustc=%s\n' "$(rustc --version)"
  printf 'cargo=%s\n' "$(cargo --version)"
} | tee "$evidence_dir/qualification-metadata.txt"

printf '\n== Running mandatory end-to-end native qualification ==\n'
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! bash "$script_dir/qualify_native_linux.sh" 2>&1 | tee "$evidence_dir/native-qualification.log"; then
  fail "strict native qualification failed; see $evidence_dir/native-qualification.log"
fi

{
  printf '\nNATIVE QUALIFICATION PASSED\n'
  printf 'landlock_abi=%s (required >= 8)\n' "$landlock_abi"
  printf 'ebpf_object_sha256=%s\n' "$(sha256sum "$KLYN_EBPF_OBJECT" | awk '{print $1}')"
  printf 'Evidence directory: %s\n' "$evidence_dir"
} | tee -a "$evidence_dir/qualification-metadata.txt"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo '## Native Linux qualification'
    echo '- Result: **PASS**'
    echo "- Commit: $(git -C "$KLYN_REPOSITORY" rev-parse HEAD)"
    echo "- Kernel: $(uname -r)"
    echo "- Landlock ABI: $landlock_abi"
    echo "- eBPF object SHA-256: $(sha256sum "$KLYN_EBPF_OBJECT" | awk '{print $1}')"
    echo "- Evidence: `$evidence_dir` (also emitted in job logs)"
  } >> "$GITHUB_STEP_SUMMARY"
fi
printf 'NATIVE QUALIFICATION EVIDENCE: %s\n' "$evidence_dir"
