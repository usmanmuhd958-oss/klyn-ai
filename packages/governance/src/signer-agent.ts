import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify,
} from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createServer, type Server } from 'node:net';

const PROTOCOL_VERSION = 1;
const MAX_FRAME_BYTES = 64 * 1024;

export interface Ed25519HsmKmsDriver {
  readonly keyId: string;
  readonly keyEpoch: string;
  /** Raw 32-byte Ed25519 public key. Public material only. */
  readonly publicKeyRaw: Uint8Array;
  /** Ask the HSM/PKCS#11 module or KMS API to sign the bytes without exporting its private key. */
  signEd25519(message: Uint8Array): Promise<Uint8Array>;
}

/** Adapt a PKCS#11 session; the injected driver retains all private key custody. */
export class Pkcs11Ed25519Driver implements Ed25519HsmKmsDriver {
  public constructor(
    public readonly keyId: string,
    public readonly keyEpoch: string,
    public readonly publicKeyRaw: Uint8Array,
    private readonly signWithHsm: (message: Uint8Array) => Promise<Uint8Array>,
  ) {}
  public async signEd25519(message: Uint8Array): Promise<Uint8Array> {
    return await this.signWithHsm(message);
  }
}

/** Adapt an authenticated cloud KMS client's Ed25519/raw-message signing operation. */
export class CloudKmsEd25519Driver implements Ed25519HsmKmsDriver {
  public constructor(
    public readonly keyId: string,
    public readonly keyEpoch: string,
    public readonly publicKeyRaw: Uint8Array,
    private readonly signWithKms: (keyId: string, message: Uint8Array) => Promise<Uint8Array>,
  ) {}
  public async signEd25519(message: Uint8Array): Promise<Uint8Array> {
    return await this.signWithKms(this.keyId, message);
  }
}

export interface SignerAgentOptions {
  readonly socketPath: string;
  /** 32 bytes encoded as 64 hex characters; provision through a secret manager. */
  readonly authTokenHex: string;
  readonly backend: Ed25519HsmKmsDriver;
  readonly maxConnections?: number;
  readonly maxFrameBytes?: number;
}

interface SignerRequest {
  readonly version: number;
  readonly token: string;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}
interface SignerResponse {
  readonly version: number;
  readonly result?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

function sameToken(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  return a.length === b.length && timingSafeEqualBuffer(a, b);
}
function timingSafeEqualBuffer(a: Buffer, b: Buffer): boolean {
  const ah = createHash('sha256').update(a).digest();
  const bh = createHash('sha256').update(b).digest();
  return timingSafeEqual(ah, bh) && a.length === b.length;
}

function requestShape(value: unknown): SignerRequest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (row.version !== PROTOCOL_VERSION || typeof row.token !== 'string' ||
      typeof row.method !== 'string' || (row.params !== undefined &&
      (typeof row.params !== 'object' || row.params === null || Array.isArray(row.params)))) return undefined;
  const allowed = new Set(['version', 'token', 'method', 'params']);
  if (Object.keys(row).some((key) => !allowed.has(key))) return undefined;
  return row as unknown as SignerRequest;
}

function responseFrame(response: SignerResponse, maximum: number): Buffer {
  const body = Buffer.from(JSON.stringify(response), 'utf8');
  if (!body.length || body.length > maximum) throw new Error('signer response exceeds frame limit');
  const frame = Buffer.allocUnsafe(4 + body.length);
  frame.writeUInt32BE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

/**
 * Standalone local signer process API compatible with Rust ExternalSignerClient.
 * It holds a provider handle but never receives or serializes private key material.
 */
export class UnixSignerAgent {
  private server: Server | undefined;
  private active = 0;
  private readonly socketPath: string;
  private readonly token: string;
  private readonly backend: Ed25519HsmKmsDriver;
  private readonly maxConnections: number;
  private readonly maxFrameBytes: number;

  public constructor(options: SignerAgentOptions) {
    if (!options.socketPath || options.socketPath.includes('\0')) throw new TypeError('socketPath is required');
    if (!/^[a-fA-F0-9]{64}$/.test(options.authTokenHex)) throw new TypeError('signer token must be 32 bytes in hex');
    if (!options.backend.keyId || !/^(0|[1-9][0-9]*)$/.test(options.backend.keyEpoch) ||
        options.backend.publicKeyRaw.length !== 32) throw new TypeError('invalid Ed25519 provider metadata');
    this.socketPath = resolve(options.socketPath);
    this.token = options.authTokenHex;
    this.backend = options.backend;
    this.maxConnections = options.maxConnections ?? 8;
    this.maxFrameBytes = options.maxFrameBytes ?? MAX_FRAME_BYTES;
    if (!Number.isSafeInteger(this.maxConnections) || this.maxConnections < 1 || this.maxConnections > 64) {
      throw new RangeError('maxConnections must be in 1..64');
    }
    if (!Number.isSafeInteger(this.maxFrameBytes) || this.maxFrameBytes < 1024 || this.maxFrameBytes > MAX_FRAME_BYTES) {
      throw new RangeError('maxFrameBytes must be in 1024..65536');
    }
  }

  public async listen(): Promise<void> {
    const parent = dirname(this.socketPath);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    const parentMeta = lstatSync(parent);
    if (parentMeta.isSymbolicLink() || !parentMeta.isDirectory() || (parentMeta.mode & 0o077) !== 0) {
      throw new Error('signer socket parent directory must be private and must not be a symlink');
    }
    try {
      const current = lstatSync(this.socketPath);
      if (!current.isSocket() || current.isSymbolicLink()) throw new Error('refusing to replace non-socket signer path');
      rmSync(this.socketPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const server = createServer((socket) => this.onConnection(socket));
    this.server = server;
    await new Promise<void>((resolvePromise, reject) => {
      server.once('error', reject);
      server.listen(this.socketPath, () => {
        server.removeListener('error', reject);
        chmodSync(this.socketPath, 0o600);
        resolvePromise();
      });
    });
  }

  public async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    await new Promise<void>((resolvePromise, reject) => {
      server.close((error) => error ? reject(error) : resolvePromise());
    });
    this.server = undefined;
    try { rmSync(this.socketPath); } catch { /* already removed by supervisor */ }
  }

  private onConnection(socket: Socket): void {
    if (this.active >= this.maxConnections) {
      socket.destroy();
      return;
    }
    this.active += 1;
    socket.setTimeout(5_000);
    socket.once('timeout', () => socket.destroy());
    socket.once('close', () => { this.active = Math.max(0, this.active - 1); });
    let accumulated = Buffer.alloc(0);
    let expected: number | undefined;

    socket.on('data', (chunk: Buffer) => {
      accumulated = Buffer.concat([accumulated, chunk]);
      if (accumulated.length > this.maxFrameBytes + 4) {
        socket.destroy();
        return;
      }
      if (expected === undefined && accumulated.length >= 4) {
        const length = accumulated.readUInt32BE(0);
        if (length < 1 || length > this.maxFrameBytes) {
          socket.destroy();
          return;
        }
        expected = length + 4;
      }
      if (expected !== undefined && accumulated.length >= expected) {
        if (accumulated.length !== expected) {
          socket.destroy();
          return;
        }
        socket.pause();
        void this.dispatch(accumulated.subarray(4)).then((response) => {
          socket.end(responseFrame(response, this.maxFrameBytes));
        }).catch(() => {
          socket.end(responseFrame({
            version: PROTOCOL_VERSION,
            error: { code: 'internal_error', message: 'signer operation failed' },
          }, this.maxFrameBytes));
        });
      }
    });
  }

  private async dispatch(bytes: Buffer): Promise<SignerResponse> {
    let value: unknown;
    try { value = JSON.parse(bytes.toString('utf8')) as unknown; }
    catch { return { version: PROTOCOL_VERSION, error: { code: 'invalid_json', message: 'invalid signer request JSON' } }; }
    const request = requestShape(value);
    if (!request) return { version: PROTOCOL_VERSION, error: { code: 'invalid_request', message: 'invalid signer request shape' } };
    if (!sameToken(this.token, request.token)) {
      return { version: PROTOCOL_VERSION, error: { code: 'unauthenticated', message: 'signer authentication failed' } };
    }
    if (request.method === 'signer.info') {
      return {
        version: PROTOCOL_VERSION,
        result: {
          keyId: this.backend.keyId,
          keyEpoch: this.backend.keyEpoch,
          publicKeyHex: Buffer.from(this.backend.publicKeyRaw).toString('hex'),
        },
      };
    }
    if (request.method === 'signer.sign') {
      const params = request.params ?? {};
      if (params.keyId !== this.backend.keyId || typeof params.payloadBase64 !== 'string') {
        return { version: PROTOCOL_VERSION, error: { code: 'invalid_params', message: 'signer key ID or payload is invalid' } };
      }
      const payload = Buffer.from(params.payloadBase64, 'base64');
      if (payload.toString('base64') !== params.payloadBase64) {
        return { version: PROTOCOL_VERSION, error: { code: 'invalid_payload', message: 'payload is not canonical Base64' } };
      }
      const signature = Buffer.from(await this.backend.signEd25519(payload));
      if (signature.length !== 64) {
        return { version: PROTOCOL_VERSION, error: { code: 'invalid_provider_signature', message: 'provider returned invalid Ed25519 signature length' } };
      }
      const publicKey = createPublicKey({
        key: Buffer.concat([
          Buffer.from('302a300506032b6570032100', 'hex'),
          Buffer.from(this.backend.publicKeyRaw),
        ]),
        format: 'der',
        type: 'spki',
      });
      if (!verify(null, payload, publicKey, signature)) {
        return { version: PROTOCOL_VERSION, error: { code: 'invalid_provider_signature', message: 'provider signature failed local verification' } };
      }
      return { version: PROTOCOL_VERSION, result: { signatureBase64: signature.toString('base64') } };
    }
    return { version: PROTOCOL_VERSION, error: { code: 'method_not_found', message: 'unknown signer method' } };
  }
}
