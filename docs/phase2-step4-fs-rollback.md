# Phase 2 Step 4 — Transactional filesystem rollback

## Contract

Each worker receives a unique mode-0700 workspace root under the daemon's private broker directory. The active candidate worktree is not mounted into this workspace and is never granted write access. Its only writable OCap grant is the workspace root; the configured runtime root remains read-only. File and directory creation over the broker uses openat2/mkdirat relative to a pinned root descriptor, rejects traversal and symlinks, and does not overwrite existing files.

The filesystem transaction is shared by the supervisor and telemetry monitor. Teardown ordering is:

1. request termination through the authoritative cgroup-v2 leaf;
2. wait until the kernel reports the cgroup empty;
3. stop broker admission and wait for the broker serving thread to exit;
4. recursively remove the transaction root without following symlinks, then fsync the parent directory;
5. append the terminal KEL CgroupDestroy event.

A rollback or broker-stop failure attempts umount2(MNT_DETACH | MNT_FORCE) on the transaction root and aborts the daemon. The same cleanup runs after explicit termination, timeout/anomaly teardown, startup/attestation failure after the cgroup has been emptied, and SpawnedWorker destruction.

## Verification boundaries

This implementation is a private ephemeral scratch transaction, not an OverlayFS mount over the candidate tree. The daemon runs unprivileged and the current stage-0 path does not provision a mount-capable user/mount namespace. Worker writes are constrained through the capability broker, and the candidate tree remains outside the worker's writable authority. A true lowerdir/upperdir CoW view requires a separately qualified mount-namespace design and is not claimed here.

The native privileged cgroup-v2 runtime job remains environment-gated. Unit tests cover nested artifact removal, symlink handling, repeated rollback, broker shutdown ordering, and secure exclusive file/directory creation; these tests do not replace deployment-kernel fault-injection qualification.
