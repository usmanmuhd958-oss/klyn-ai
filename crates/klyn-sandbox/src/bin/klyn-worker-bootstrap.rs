//! Trusted stage-zero / PID-namespace-init worker bootstrap.
//!
//! This process accepts only brokered file operations. It does not execute
//! model-supplied binaries. Arbitrary exec/fork is intentionally absent from
//! the post-enforcement syscall profile; a future runtime must be linked into
//! this trusted binary or use a separately reviewed execution boundary.

use std::{
    collections::BTreeMap,
    env,
    fs::{self, File, OpenOptions},
    io::{self, BufRead, Read, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
    process::{Command, ExitCode},
};

use ed25519_dalek::VerifyingKey;
use klyn_sandbox::{
    bootstrap_worker_from_env,
    broker::{BrokerClient, Ed25519CapabilityVerifier},
    namespace::{
        await_start_gate, create_pid_namespace_for_child, enter_worker_namespaces,
        require_pid_namespace_init,
    },
    FileAccess, SandboxError, SignedCapability, MAX_BROKER_FRAME_BYTES, MAX_MUTATION_BYTES,
};
use serde::Deserialize;
use serde_json::{json, Value};

const EXIT_CONFIGURATION: u8 = 78;
const EXIT_SANDBOX: u8 = 125;

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
enum WorkerCommand {
    Ping,
    ReadFile {
        root_id: String,
        path: String,
    },
    WriteCandidateFile {
        transaction_id: String,
        path: String,
        // Option must be explicit: null means create-only; missing is malformed.
        #[serde(deserialize_with = "deserialize_required_option")]
        expected_old_content: Option<String>,
        content: String,
    },
    Shutdown,
}

fn deserialize_required_option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

fn main() -> ExitCode {
    match entrypoint() {
        Ok(code) => ExitCode::from(code),
        Err(error) => {
            eprintln!("klyn-worker-bootstrap: {error}");
            match error {
                SandboxError::InvalidConfig(_) => ExitCode::from(EXIT_CONFIGURATION),
                _ => ExitCode::from(EXIT_SANDBOX),
            }
        }
    }
}

fn entrypoint() -> Result<u8, SandboxError> {
    if env::var("KLYN_SANDBOX_REQUIRED").as_deref() != Ok("1") {
        return Err(SandboxError::InvalidConfig(
            "KLYN_SANDBOX_REQUIRED=1 is mandatory".into(),
        ));
    }

    match env::var("KLYN_PID_NAMESPACE_STAGE").as_deref() {
        Ok("parent") => parent_stage(),
        Ok("child") => child_stage(),
        _ => Err(SandboxError::InvalidConfig(
            "unknown or missing PID namespace stage".into(),
        )),
    }
}

fn parent_stage() -> Result<u8, SandboxError> {
    let gate = env::var_os("KLYN_START_GATE_PATH")
        .ok_or_else(|| SandboxError::InvalidConfig("start gate path is missing".into()))?;

    // The supervisor releases this process only after cgroup.procs contains
    // its PID. All namespace setup errors abort before a task is accepted.
    await_start_gate(Path::new(&gate))?;
    enter_worker_namespaces()?;
    create_pid_namespace_for_child()?;

    // unshare(CLONE_NEWPID) affects future children, not the caller. Re-exec
    // this trusted binary so its child is PID 1 in the new PID namespace.
    let executable = env::current_exe()?;
    let mut command = Command::new(executable);
    command
        .env("KLYN_PID_NAMESPACE_STAGE", "child")
        .stdin(std::process::Stdio::inherit())
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::null());

    let mut child = command.spawn()?;
    let status = child.wait()?;
    Ok(status
        .code()
        .map(|code| code.clamp(0, 255) as u8)
        .unwrap_or(EXIT_SANDBOX))
}

fn child_stage() -> Result<u8, SandboxError> {
    require_pid_namespace_init()?;

    let manifest = required_path("KLYN_CAPABILITY_MANIFEST")?;
    let broker_socket = required_path("KLYN_BROKER_SOCKET")?;
    let roots_manifest = required_path("KLYN_ROOTS_MANIFEST")?;
    let public_key = read_public_key_from_env()?;
    let roots: BTreeMap<String, PathBuf> = read_private_json(&roots_manifest)?;

    for (root_id, path) in &roots {
        if root_id.is_empty() || root_id.len() > 128 {
            return Err(SandboxError::InvalidConfig(
                "invalid root ID in roots manifest".into(),
            ));
        }
        let canonical = fs::canonicalize(path)?;
        if !canonical.is_dir() || canonical.as_path() != path.as_path() {
            return Err(SandboxError::InvalidConfig(format!(
                "root must be a canonical directory: {}",
                path.display()
            )));
        }
        let metadata = fs::metadata(&canonical)?;
        if metadata.mode() & 0o022 != 0 {
            return Err(SandboxError::InvalidConfig(format!(
                "root directory is writable by group/other: {}",
                canonical.display()
            )));
        }
    }

    let verifier = Ed25519CapabilityVerifier::new(public_key);
    let (broker, token) = bootstrap_worker_from_env(&manifest, &broker_socket, &verifier, &roots)?;

    // From this point, Landlock and seccomp are active. The only file operations
    // available to this process are via already-open stdio and descriptors
    // explicitly returned by the authorized broker.
    worker_loop(&broker, &token)?;
    Ok(0)
}

fn worker_loop(broker: &BrokerClient, capability: &SignedCapability) -> Result<(), SandboxError> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = stdin.lock();
    let mut writer = stdout.lock();
    let mut line = String::new();

    loop {
        line.clear();
        let read = reader.read_line(&mut line)?;
        if read == 0 {
            return Ok(());
        }
        if line.len() > MAX_BROKER_FRAME_BYTES {
            write_response(
                &mut writer,
                &json!({"ok": false, "error": "request too large"}),
            )?;
            continue;
        }

        let command: WorkerCommand = match serde_json::from_str(&line) {
            Ok(command) => command,
            Err(_) => {
                write_response(
                    &mut writer,
                    &json!({"ok": false, "error": "invalid worker command"}),
                )?;
                continue;
            }
        };

        match command {
            WorkerCommand::Ping => {
                write_response(
                    &mut writer,
                    &json!({
                        "ok": true,
                        "pid": nix::unistd::getpid().as_raw(),
                        "namespace_init": true,
                        "sandbox": "landlock+seccomp+user+mount+network+ipc+uts+pid"
                    }),
                )?;
            }
            WorkerCommand::ReadFile { root_id, path } => {
                let result = broker_read_file(broker, capability, &root_id, &path);
                match result {
                    Ok(content) => {
                        write_response(&mut writer, &json!({"ok": true, "content": content}))?
                    }
                    Err(_) => write_response(
                        &mut writer,
                        &json!({"ok": false, "error": "broker denied file read"}),
                    )?,
                }
            }
            WorkerCommand::WriteCandidateFile {
                transaction_id,
                path,
                expected_old_content,
                content,
            } => {
                if content.len() > MAX_MUTATION_BYTES
                    || expected_old_content
                        .as_ref()
                        .is_some_and(|old| old.len() > MAX_MUTATION_BYTES)
                {
                    write_response(
                        &mut writer,
                        &json!({"ok": false, "error": "mutation too large"}),
                    )?;
                    continue;
                }
                match broker.write_candidate_file(
                    capability,
                    transaction_id,
                    path,
                    expected_old_content,
                    content,
                ) {
                    Ok(()) => write_response(&mut writer, &json!({"ok": true}))?,
                    Err(_) => write_response(
                        &mut writer,
                        &json!({"ok": false, "error": "transactional mutation denied"}),
                    )?,
                }
            }
            WorkerCommand::Shutdown => {
                write_response(&mut writer, &json!({"ok": true, "state": "stopping"}))?;
                writer.flush()?;
                return Ok(());
            }
        }
    }
}

fn broker_read_file(
    broker: &BrokerClient,
    capability: &SignedCapability,
    root_id: &str,
    path: &str,
) -> Result<String, SandboxError> {
    let descriptor = broker
        .open_file(
            capability,
            root_id.to_owned(),
            path.to_owned(),
            FileAccess::Read,
        )
        .map_err(SandboxError::Enforcement)?;
    let mut file = File::from(descriptor);
    let mut bytes = Vec::new();
    (&mut file)
        .take((MAX_MUTATION_BYTES + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > MAX_MUTATION_BYTES {
        return Err(SandboxError::InvalidConfig(
            "read exceeds the size limit".into(),
        ));
    }
    String::from_utf8(bytes)
        .map_err(|_| SandboxError::InvalidConfig("file content is not UTF-8".into()))
}

fn read_public_key_from_env() -> Result<VerifyingKey, SandboxError> {
    let encoded = env::var("KLYN_CAPABILITY_PUBLIC_KEY_HEX")
        .map_err(|_| SandboxError::InvalidConfig("public verifying key is missing".into()))?;
    if encoded.len() != 64 || !encoded.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(SandboxError::InvalidConfig(
            "public verifying key must be exactly 64 hexadecimal characters".into(),
        ));
    }
    let mut bytes = [0u8; 32];
    for (index, slot) in bytes.iter_mut().enumerate() {
        let start = index * 2;
        *slot = u8::from_str_radix(&encoded[start..start + 2], 16)
            .map_err(|_| SandboxError::InvalidConfig("invalid public key hex".into()))?;
    }
    VerifyingKey::from_bytes(&bytes)
        .map_err(|_| SandboxError::InvalidConfig("invalid Ed25519 public key".into()))
}

fn required_path(key: &str) -> Result<PathBuf, SandboxError> {
    let path = env::var_os(key)
        .map(PathBuf::from)
        .ok_or_else(|| SandboxError::InvalidConfig(format!("{key} is missing")))?;
    if !path.is_absolute() {
        return Err(SandboxError::InvalidConfig(format!(
            "{key} must be absolute"
        )));
    }
    Ok(path)
}

fn read_private_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, SandboxError> {
    let before = fs::symlink_metadata(path)?;
    let uid = nix::unistd::Uid::current().as_raw();
    if before.file_type().is_symlink()
        || !before.is_file()
        || before.uid() != uid
        || before.mode() & 0o077 != 0
        || before.len() > MAX_BROKER_FRAME_BYTES as u64
    {
        return Err(SandboxError::InvalidConfig(
            "worker configuration must be a private, bounded regular file".into(),
        ));
    }

    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)?;
    let after = file.metadata()?;
    if !after.is_file()
        || after.uid() != uid
        || after.ino() != before.ino()
        || after.dev() != before.dev()
    {
        return Err(SandboxError::Enforcement(
            "worker configuration identity changed while opening".into(),
        ));
    }

    let mut bytes = Vec::with_capacity(after.len() as usize);
    (&mut file)
        .take((MAX_BROKER_FRAME_BYTES + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.is_empty() || bytes.len() > MAX_BROKER_FRAME_BYTES {
        return Err(SandboxError::InvalidConfig(
            "worker configuration is empty or oversized".into(),
        ));
    }
    serde_json::from_slice(&bytes).map_err(SandboxError::from)
}

fn write_response(writer: &mut impl Write, response: &Value) -> Result<(), SandboxError> {
    let encoded = serde_json::to_vec(response)?;
    if encoded.len() > MAX_BROKER_FRAME_BYTES {
        return Err(SandboxError::Enforcement(
            "worker response is oversized".into(),
        ));
    }
    writer.write_all(&encoded)?;
    writer.write_all(b"\n")?;
    writer.flush()?;
    Ok(())
}
