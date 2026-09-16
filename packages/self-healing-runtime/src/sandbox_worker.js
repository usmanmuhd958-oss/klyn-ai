// =============================================================================
// KLYN AI OS — self-healing-runtime — Sandbox Worker (Phase 5)
// File: packages/self-healing-runtime/src/sandbox_worker.js
//
// The isolated execution boundary for untrusted agent-generated code. Runs
// inside a Node worker_threads process (own memory space, resourceLimits from
// the host) and executes every payload through a node:vm context that exposes
// ONLY safe globals — no process, no require, no fs, no network, no dynamic
// import. The host enforces a hard wall-clock timeout by terminating the
// worker; the vm `timeout` bounds a single script's CPU burst.
//
// Two payload kinds:
//   { kind: 'js',   code, args, cpuTimeMs }  — arbitrary script wrapped in an
//     async function; `__klynArgs` holds the argument array; top-level
//     `return` and top-level `await` both work.
//   { kind: 'wasm', wasm: Uint8Array, fn, args } — instantiate the module
//     with an EMPTY import object (no host imports = no I/O) and call the
//     named export.
//
// Results are JSON-clean (cloneable across the worker boundary). Any
// violation (escape attempt, missing export, timeout) becomes { ok: false }.
// =============================================================================
import { parentPort } from 'node:worker_threads';
import vm from 'node:vm';

// Static escape-attempt pre-filter: native I/O / host access vectors that must
// never reach the vm context. Conservative by design — rejected loudly.
const REJECTED_PATTERNS = [
  /import\s*\(/,
  /\.constructor\s*\.\s*constructor/,
  /process\s*\./,
  /\brequire\s*\(/,
  /\bglobalThis\b/,
  /\bmodule\s*\.\s*exports/,
];

const SAFE_GLOBALS = {
  console,
  Math,
  JSON,
  Date,
  Map,
  Set,
  Promise,
  Uint8Array,
  ArrayBuffer,
  TextEncoder,
  TextDecoder,
  structuredClone,
  Number,
  String,
  Boolean,
  Array,
  Object,
};

function preflight(code) {
  for (const pattern of REJECTED_PATTERNS) {
    if (pattern.test(code)) {
      return `rejected: code matches forbidden host-access pattern ${pattern}`;
    }
  }
  return null;
}

function jsonClean(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

parentPort.on('message', async (msg) => {
  const { id, kind } = msg;
  try {
    if (kind === 'js') {
      const rejected = preflight(String(msg.code ?? ''));
      if (rejected) {
        parentPort.postMessage({ id, ok: false, error: rejected });
        return;
      }
      const context = vm.createContext({ ...SAFE_GLOBALS });
      const wrapper = `(async function(__klynArgs){ ${msg.code} })`;
      const fn = vm.runInContext(wrapper, context, {
        timeout: msg.cpuTimeMs ?? 500,
        filename: 'klyn-sandbox.js',
      });
      const result = await fn(msg.args ?? []);
      parentPort.postMessage({ id, ok: true, result: jsonClean(result) });
    } else if (kind === 'wasm') {
      const bytes = new Uint8Array(msg.wasm);
      // Empty import object: the module gets ZERO host capabilities.
      const { instance } = await WebAssembly.instantiate(bytes, {});
      const fn = instance.exports[msg.fn];
      if (typeof fn !== 'function') {
        parentPort.postMessage({ id, ok: false, error: `wasm export "${msg.fn}" not found` });
        return;
      }
      const result = fn(...(msg.args ?? []));
      parentPort.postMessage({ id, ok: true, result: typeof result === 'bigint' ? Number(result) : jsonClean(result) });
    } else {
      parentPort.postMessage({ id, ok: false, error: `unknown sandbox kind "${kind}"` });
    }
  } catch (error) {
    parentPort.postMessage({
      id,
      ok: false,
      error: String(error instanceof Error ? error.message : error),
    });
  }
});
