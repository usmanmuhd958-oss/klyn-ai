#!/usr/bin/env bash
# Boot a disposable QEMU/KVM guest, verify it, run native qualification, collect evidence.
# The approved base image must contain the guest kernel, SSH account and trusted fixtures.
set -Eeuo pipefail
umask 077

fail() {
  printf 'MICROVM QUALIFICATION FAILED: %s\n' "$*" >&2
  exit 1
}
require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "required environment variable $name is unset"
}

[[ "${KLYN_NATIVE_QUALIFICATION_READY:-false}" == "true" ]] ||
  fail "KLYN_NATIVE_QUALIFICATION_READY must be exactly true; the approved guest image must be provisioned"
[[ "$(uname -s)" == "Linux" ]] || fail "QEMU/KVM qualification requires a Linux host"
[[ "$(uname -m)" == "x86_64" ]] || fail "this runner currently supports x86_64 only"
[[ "$(id -u)" -ne 0 ]] || fail "run QEMU as an unprivileged CI user, not UID 0"

for command_name in qemu-system-x86_64 qemu-img ssh ssh-keyscan ssh-keygen tar sha256sum python3; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command is missing: $command_name"
done
[[ -c /dev/kvm && -r /dev/kvm && -w /dev/kvm ]] ||
  fail "/dev/kvm is unavailable or not readable/writable by this runner user"

require_env KLYN_VM_BASE_IMAGE
require_env KLYN_VM_BASE_IMAGE_SHA256
require_env KLYN_VM_SSH_KEY
[[ "$KLYN_VM_BASE_IMAGE_SHA256" =~ ^[0-9a-fA-F]{64}$ ]] || fail "KLYN_VM_BASE_IMAGE_SHA256 must be a 64-character SHA-256 hex digest"
[[ -f "$KLYN_VM_BASE_IMAGE" && -r "$KLYN_VM_BASE_IMAGE" && ! -L "$KLYN_VM_BASE_IMAGE" ]] ||
  fail "KLYN_VM_BASE_IMAGE must be a readable, non-symlink approved image"
[[ "$(stat -c '%u' "$KLYN_VM_BASE_IMAGE")" == "0" ]] ||
  fail "approved base image must be root-owned on the runner"
image_mode=$((8#$(stat -c '%a' "$KLYN_VM_BASE_IMAGE")))
(( (image_mode & 022) == 0 )) || fail "approved base image must not be group/world writable"
[[ -f "$KLYN_VM_SSH_KEY" && -r "$KLYN_VM_SSH_KEY" && ! -L "$KLYN_VM_SSH_KEY" ]] ||
  fail "KLYN_VM_SSH_KEY must be a readable, non-symlink private key"
key_mode=$((8#$(stat -c '%a' "$KLYN_VM_SSH_KEY")))
(( (key_mode & 077) == 0 )) || fail "KLYN_VM_SSH_KEY must not be group/world accessible"

source_dir="$(realpath -e "${KLYN_VM_SOURCE_DIR:-$PWD}")" ||
  fail "KLYN_VM_SOURCE_DIR does not exist"
git -C "$source_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1 ||
  fail "KLYN_VM_SOURCE_DIR must be a Git checkout"
[[ -z "$(git -C "$source_dir" status --porcelain --untracked-files=all)" ]] ||
  fail "source checkout must be clean before it is copied into the guest"

base_image="$(realpath -e "$KLYN_VM_BASE_IMAGE")"
actual_image_sha="$(sha256sum "$base_image" | awk '{print $1}')"
[[ "${actual_image_sha,,}" == "${KLYN_VM_BASE_IMAGE_SHA256,,}" ]] || fail "approved base image SHA-256 does not match KLYN_VM_BASE_IMAGE_SHA256"
printf 'base_image_sha256=%s\n' "$actual_image_sha" | tee -a "$artifact_dir/host-metadata.txt"
image_info="$(qemu-img info --output=json "$base_image")" ||
  fail "qemu-img cannot inspect the approved base image"
base_format="$(printf '%s' "$image_info" | python3 -c 'import json,sys; print(json.load(sys.stdin)["format"])')" ||
  fail "could not read base image format"
virtual_size="$(printf '%s' "$image_info" | python3 -c 'import json,sys; print(int(json.load(sys.stdin)["virtual-size"]))')" ||
  fail "could not read base image size"
[[ "$base_format" == "qcow2" || "$base_format" == "raw" ]] ||
  fail "unsupported base disk format: $base_format"

run_id="${KLYN_VM_RUN_ID:-${GITHUB_RUN_ID:-${CI_PIPELINE_ID:-local-$$}}}"
[[ "$run_id" =~ ^[A-Za-z0-9_.-]+$ ]] || fail "run identifier contains unsafe characters"
evidence_root="${KLYN_NATIVE_EVIDENCE_ROOT:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}}"
mkdir -p "$evidence_root"
artifact_dir="$evidence_root/klyn-microvm-$run_id"
mkdir -p "$artifact_dir"
chmod 0700 "$artifact_dir"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/klyn-qemu.XXXXXXXX")"
qemu_pid=""
guest_port="${KLYN_VM_SSH_PORT:-$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')}"
[[ "$guest_port" =~ ^[0-9]+$ ]] && (( guest_port >= 1024 && guest_port <= 65535 )) ||
  fail "SSH forwarding port must be in range 1024..65535"
guest_user="${KLYN_VM_SSH_USER:-klyn-qualifier}"
[[ "$guest_user" =~ ^[A-Za-z_][A-Za-z0-9_.-]*[$]?$ ]] || fail "invalid KLYN_VM_SSH_USER"
ssh_target="$guest_user@127.0.0.1"
known_hosts="$work_dir/known_hosts"
overlay="$work_dir/qualification-overlay.qcow2"
serial_log="$work_dir/serial.log"
pid_file="$work_dir/qemu.pid"

cleanup() {
  local code=$?
  trap - EXIT
  if [[ -n "$qemu_pid" ]] && kill -0 "$qemu_pid" 2>/dev/null; then
    kill -TERM "$qemu_pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$qemu_pid" 2>/dev/null || break
      sleep 0.25
    done
    kill -KILL "$qemu_pid" 2>/dev/null || true
  fi
  if [[ -f "$serial_log" ]]; then
    cp "$serial_log" "$artifact_dir/serial.log" 2>/dev/null || true
  fi
  printf 'microvm_cleanup_exit_status=%s\n' "$code" > "$artifact_dir/cleanup-status.txt"
  rm -rf -- "$work_dir"
  exit "$code"
}
trap cleanup EXIT

{
  printf 'host_kernel=%s\n' "$(uname -a)"
  printf 'qemu=%s\n' "$(qemu-system-x86_64 --version | head -n 1)"
  printf 'base_image=%s\n' "$base_image"
  printf 'base_image_format=%s\n' "$base_format"
  printf 'base_image_virtual_size=%s\n' "$virtual_size"
  printf 'source_commit=%s\n' "$(git -C "$source_dir" rev-parse HEAD)"
  printf 'source_branch=%s\n' "$(git -C "$source_dir" branch --show-current)"
  printf 'guest_user=%s\n' "$guest_user"
  printf 'guest_ssh_port=%s\n' "$guest_port"
} | tee "$artifact_dir/host-metadata.txt"

qemu-img create -q -f qcow2 -F "$base_format" -b "$base_image" "$overlay" "$virtual_size" ||
  fail "could not create ephemeral QCOW2 overlay"

qemu-system-x86_64 \
  -enable-kvm -cpu host -smp "${KLYN_VM_CPUS:-2}" -m "${KLYN_VM_MEMORY_MIB:-4096}" \
  -drive "file=$overlay,if=virtio,format=qcow2" \
  -netdev "user,id=net0,hostfwd=tcp:127.0.0.1:$guest_port-:22" \
  -device virtio-net-pci,netdev=net0 \
  -display none -monitor none -serial "file:$serial_log" \
  -no-reboot -daemonize -pidfile "$pid_file" ||
  fail "QEMU failed to launch; check KVM permissions and guest image boot configuration"
[[ -s "$pid_file" ]] || fail "QEMU started without writing a PID file"
qemu_pid="$(cat "$pid_file")"
[[ "$qemu_pid" =~ ^[0-9]+$ ]] || fail "QEMU produced an invalid PID"
kill -0 "$qemu_pid" 2>/dev/null || fail "QEMU exited immediately"

ssh_options=(
  -p "$guest_port"
  -i "$KLYN_VM_SSH_KEY"
  -o IdentitiesOnly=yes
  -o BatchMode=yes
  -o StrictHostKeyChecking=yes
  -o UserKnownHostsFile="$known_hosts"
  -o ConnectTimeout=3
  -o ServerAliveInterval=5
  -o ServerAliveCountMax=2
)
ssh_ready=false
for attempt in $(seq 1 "${KLYN_VM_BOOT_ATTEMPTS:-90}"); do
  if ssh-keyscan -T 2 -p "$guest_port" 127.0.0.1 >> "$known_hosts" 2>/dev/null &&
     [[ -s "$known_hosts" ]] &&
     ssh "${ssh_options[@]}" "$ssh_target" 'true' >/dev/null 2>&1; then
    ssh_ready=true
    break
  fi
  kill -0 "$qemu_pid" 2>/dev/null || fail "QEMU exited before guest SSH became ready"
  sleep 2
done
[[ "$ssh_ready" == "true" ]] || fail "guest SSH did not become ready before the boot timeout"
sort -u "$known_hosts" -o "$known_hosts"
ssh-keygen -lf "$known_hosts" > "$artifact_dir/guest-host-key-fingerprint.txt" ||
  fail "cannot read guest SSH host-key fingerprint"
printf 'guest_ssh=ready\n' | tee -a "$artifact_dir/host-metadata.txt"

remote_home="$(ssh "${ssh_options[@]}" "$ssh_target" 'printf "%s\n" "$HOME"')" ||
  fail "cannot resolve guest user's home directory"
[[ "$remote_home" =~ ^/[A-Za-z0-9_./-]+$ ]] || fail "guest returned an unsafe home path"
remote_root="$remote_home/klyn-phase3-$run_id"
printf 'guest_work_root=%s\n' "$remote_root" | tee -a "$artifact_dir/host-metadata.txt"

tar -czf - --exclude='./target' --exclude='./.git/index.lock' -C "$source_dir" . |
  ssh "${ssh_options[@]}" "$ssh_target" \
    "rm -rf '$remote_root' && mkdir -p '$remote_root/repository' && tar -xzf - -C '$remote_root/repository'" ||
  fail "failed to transfer source checkout into the disposable guest"

set +e
ssh "${ssh_options[@]}" "$ssh_target" "KLYN_VM_GUEST_ROOT='$remote_root' bash -s" 2>&1 <<'GUEST_SCRIPT' | tee "$artifact_dir/guest-qualification.log"
set -Eeuo pipefail

repository_root="${KLYN_VM_GUEST_ROOT:?guest source root was not supplied}/repository"
repository="$(realpath -e "$repository_root")" || { echo "guest repository is missing" >&2; exit 1; }
[[ -f /etc/klyn/qualification.env && ! -L /etc/klyn/qualification.env ]] ||
  { echo "/etc/klyn/qualification.env must be provisioned in the approved base image" >&2; exit 1; }
[[ "$(stat -c '%u' /etc/klyn/qualification.env)" == "0" ]] ||
  { echo "qualification.env must be root-owned" >&2; exit 1; }
env_mode=$((8#$(stat -c '%a' /etc/klyn/qualification.env)))
(( (env_mode & 022) == 0 )) ||
  { echo "qualification.env must not be group/world writable" >&2; exit 1; }
[[ "$(id -u)" -ne 0 ]] || { echo "qualification must run as an unprivileged guest user" >&2; exit 1; }

set -a
# This file is a trusted part of the approved image, not an input from the checkout.
source /etc/klyn/qualification.env
set +a
export KLYN_NATIVE_QUALIFICATION_READY=true
export KLYN_NATIVE_EPHEMERAL_VM=true
export KLYN_REPOSITORY="$repository"
export KLYN_NATIVE_EVIDENCE_ROOT="$HOME/klyn-native-evidence"
export KLYN_REQUIRE_NATIVE_LINUX_QUALIFICATION=1
mkdir -p "$KLYN_NATIVE_EVIDENCE_ROOT"
cd "$KLYN_REPOSITORY"
printf 'guest_kernel=%s\n' "$(uname -a)"
printf 'guest_commit=%s\n' "$(git rev-parse HEAD)"
bash scripts/orchestrate_native_qualification.sh
GUEST_SCRIPT
guest_status=${PIPESTATUS[0]}
set -e

set +e
ssh "${ssh_options[@]}" "$ssh_target" \
  "if [[ -d '$remote_home/klyn-native-evidence' ]]; then tar -czf - -C '$remote_home/klyn-native-evidence' .; else exit 3; fi" \
  > "$artifact_dir/guest-native-evidence.tar.gz"
evidence_status=$?
set -e
if (( evidence_status != 0 )); then
  printf 'warning: guest evidence archive collection failed (status=%s)\n' "$evidence_status" |
    tee -a "$artifact_dir/host-metadata.txt"
fi

if (( guest_status != 0 )); then
  printf 'MICROVM QUALIFICATION FAILED: guest orchestrator status=%s\n' "$guest_status" >&2
  exit "$guest_status"
fi
grep -q 'NATIVE QUALIFICATION PASSED' "$artifact_dir/guest-qualification.log" ||
  fail "guest exited zero without the native qualification success marker"
printf 'MICROVM QUALIFICATION PASSED: evidence=%s\n' "$artifact_dir"
