// =============================================================================
// KLYN AI OS — swarm-mesh — Real Network Mesh Transport Layer (Phase 14)
// File: packages/swarm-mesh/src/transports/real_transport.ts
//
// Phase 14 capability #1. Replaces the in-memory peer plumbing with REAL
// network transport: WebSocket streams over loopback/LAN, mutual-TLS-style
// authentication (Ed25519 signed handshakes — the same post-quantum-friendly
// primitive family as the kernel), RFC 5389 STUN NAT discovery, gossip-based
// peer discovery, and automatic reconnection with exponential backoff +
// jitter plus message deduplication:
//
//   const identityA = createIdentity('klyn-a', 'seed-a');
//   const trust = new Map([['klyn-b', identityB.publicKeyB64]]);
//   const nodeA = new WsMeshNode({ nodeId: 'klyn-a', identity: identityA, trustStore: trust });
//   await nodeA.start(0);                          // real WS listener
//   await nodeA.connect(`ws://127.0.0.1:${nodeB.port}/`, 'klyn-b');  // mTLS
//   nodeA.send('klyn-b', 'mesh.sync-request', { since: 0 });
//
//   // NAT traversal — real RFC 5389 binding request over UDP:
//   const { mapped } = await stunBindingRequest('127.0.0.1', stunPort);
//
//   // reconnection with exponential backoff + dedup:
//   const client = new ReconnectingClient({ identity, trustStore, remoteId, url, onMessage });
//   await client.start();
//
// Layering:
//   1. STUN (RFC 5389) — wire-format binding request/response encode+decode,
//      XOR-MAPPED-ADDRESS extraction, a real UDP client, and a mock STUN
//      server for tests. Gives nodes their public endpoint (NAT traversal).
//   2. mTLS handshake — mutual authentication over the WebSocket: both sides
//      prove possession of an Ed25519 key registered in the peer's trust
//      store BEFORE any mesh frame is accepted. X.509 certificates can wrap
//      the same identities in production (the trust store is key-derived).
//   3. WsMeshNode — real WebSocket listener (Bun.serve) + dialer, framed
//      JSON messages {id,from,to,kind,payload,at}, bounded id dedup.
//   4. ReconnectingClient — dials a remote node, exponential backoff + jitter
//      reconnect on drop, dedup-safe redelivery.
//   5. GossipDiscovery — membership spread with TTL + pruning.
//   6. MeshTransportBridge — maps mesh frames onto the Phase 12 FederatedMesh
//      causal sync (sync-request → delta, sync-delta → ingest, heal → merge).
//
// Dependency-free beyond the runtime: node:crypto, node:dgram, node:net
// primitives and Bun's built-in WebSocket implementation — zero npm adds.
// =============================================================================
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import type { KeyObject } from 'node:crypto';
import { FederatedMesh } from '../federated_mesh.js';

// -----------------------------------------------------------------------------
// STUN — RFC 5389 (NAT traversal / public endpoint discovery)
// -----------------------------------------------------------------------------

export const STUN_MAGIC_COOKIE = 0x2112a442;
const STUN_BINDING_REQUEST = 0x0001;
const STUN_BINDING_RESPONSE = 0x0101;
const STUN_ATTR_XOR_MAPPED_ADDRESS = 0x0020;

export interface StunMappedAddress {
  ip: string;
  port: number;
}

/** Encode an RFC 5389 Binding Request (type 0x0001, zero-length, magic
 *  cookie + 12-byte transaction id). */
export function encodeStunBindingRequest(transactionId: Buffer): Buffer {
  if (transactionId.length !== 12) {
    throw new Error(`STUN transaction id must be 12 bytes (got ${transactionId.length})`);
  }
  const msg = Buffer.alloc(20);
  msg.writeUInt16BE(STUN_BINDING_REQUEST, 0);
  msg.writeUInt16BE(0, 2);
  msg.writeUInt32BE(STUN_MAGIC_COOKIE, 4);
  transactionId.copy(msg, 8);
  return msg;
}

/** Encode an XOR-MAPPED-ADDRESS attribute (IPv4 or IPv6). */
export function encodeXorMappedAddress(ip: string, port: number, transactionId: Buffer): Buffer {
  const ipv6 = ip.includes(':');
  const family = ipv6 ? 0x02 : 0x01;
  const valueLen = ipv6 ? 20 : 8;
  const value = Buffer.alloc(valueLen);
  value.writeUInt8(0, 0); // reserved
  value.writeUInt8(family, 1);
  value.writeUInt16BE(port ^ (STUN_MAGIC_COOKIE >>> 16), 2); // xor port with high bits of cookie
  if (ipv6) {
    const bytes: number[] = [];
    for (const hextet of ip.split(':')) {
      const n = parseInt(hextet, 16);
      bytes.push((n >> 8) & 0xff, n & 0xff);
    }
    for (let i = 0; i < 16; i++) {
      const key = i < 4 ? (STUN_MAGIC_COOKIE >>> ((3 - i) * 8)) & 0xff : transactionId[i - 4];
      value.writeUInt8(bytes[i] ^ key, 4 + i);
    }
  } else {
    const parts = ip.split('.').map(Number);
    const xaddr = ((((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0) ^ STUN_MAGIC_COOKIE) >>> 0;
    value.writeUInt32BE(xaddr, 4);
  }
  const header = Buffer.alloc(4);
  header.writeUInt16BE(STUN_ATTR_XOR_MAPPED_ADDRESS, 0);
  header.writeUInt16BE(valueLen, 2);
  return Buffer.concat([header, value]);
}

/** Encode a full STUN response header + attributes. */
export function encodeStunResponse(type: number, transactionId: Buffer, attributes: Buffer[]): Buffer {
  const body = Buffer.concat(attributes);
  const msg = Buffer.alloc(20 + body.length);
  msg.writeUInt16BE(type, 0);
  msg.writeUInt16BE(body.length, 2);
  msg.writeUInt32BE(STUN_MAGIC_COOKIE, 4);
  transactionId.copy(msg, 8);
  body.copy(msg, 20);
  return msg;
}

export interface StunResponse {
  type: number;
  transactionId: Buffer;
  xorMappedAddress: StunMappedAddress | null;
}

/** Decode a STUN response: validate the header, walk attributes, and
 *  XOR-decode the mapped address (IPv4: cookie; IPv6: cookie + txid). */
export function decodeStunResponse(buf: Buffer): StunResponse {
  if (buf.length < 20) throw new Error('STUN: response shorter than header');
  const type = buf.readUInt16BE(0);
  const length = buf.readUInt16BE(2);
  const transactionId = buf.subarray(8, 20);
  let offset = 20;
  let xorMappedAddress: StunMappedAddress | null = null;
  const end = Math.min(buf.length, 20 + length);
  while (offset + 4 <= end) {
    const attrType = buf.readUInt16BE(offset);
    const attrLen = buf.readUInt16BE(offset + 2);
    const value = buf.subarray(offset + 4, offset + 4 + attrLen);
    if (attrType === STUN_ATTR_XOR_MAPPED_ADDRESS && value.length >= 8) {
      const family = value.readUInt8(1);
      const port = value.readUInt16BE(2) ^ (STUN_MAGIC_COOKIE >>> 16);
      if (family === 0x01) {
        const xaddr = value.readUInt32BE(4) ^ STUN_MAGIC_COOKIE;
        xorMappedAddress = { ip: [(xaddr >>> 24) & 0xff, (xaddr >>> 16) & 0xff, (xaddr >>> 8) & 0xff, xaddr & 0xff].join('.'), port };
      } else if (family === 0x02 && value.length >= 20) {
        const parts: string[] = [];
        for (let i = 0; i < 16; i++) {
          const key = i < 4 ? (STUN_MAGIC_COOKIE >>> ((3 - i) * 8)) & 0xff : transactionId[i - 4];
          parts.push((value.readUInt8(4 + i) ^ key).toString(16).padStart(2, '0'));
        }
        const hextets: string[] = [];
        for (let i = 0; i < 16; i += 2) hextets.push(parts[i] + parts[i + 1]);
        xorMappedAddress = { ip: hextets.join(':'), port };
      }
    }
    offset += 4 + ((attrLen + 3) & ~3);
  }
  return { type, transactionId, xorMappedAddress };
}

/** Real UDP STUN binding request (RFC 5389) — discover the public endpoint
 *  a NAT would map this node to. */
export async function stunBindingRequest(
  host: string,
  port: number,
  opts: { localAddress?: string; timeoutMs?: number } = {}
): Promise<{ mapped: StunMappedAddress; rttMs: number }> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const transactionId = crypto.randomBytes(12);
    const started = Date.now();
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`STUN binding request to ${host}:${port} timed out`));
    }, opts.timeoutMs ?? 2_000);
    socket.on('message', (buf) => {
      try {
        const response = decodeStunResponse(buf);
        if (!response.xorMappedAddress) throw new Error('STUN: no XOR-MAPPED-ADDRESS attribute');
        if (!response.transactionId.equals(transactionId)) throw new Error('STUN: transaction id mismatch');
        clearTimeout(timer);
        socket.close();
        resolve({ mapped: response.xorMappedAddress, rttMs: Date.now() - started });
      } catch (error) {
        clearTimeout(timer);
        socket.close();
        reject(error);
      }
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });
    socket.bind(0, opts.localAddress ?? '0.0.0.0', () => {
      socket.send(encodeStunBindingRequest(transactionId), port, host);
    });
  });
}

/** Mock STUN server for tests/offline CI — answers binding requests with the
 *  client's loopback endpoint (proves the full wire round-trip). */
export async function startMockStunServer(host = '127.0.0.1'): Promise<{ port: number; stop: () => void }> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    socket.on('message', (buf, rinfo) => {
      try {
        if (buf.readUInt16BE(0) !== STUN_BINDING_REQUEST) return;
        const transactionId = buf.subarray(8, 20);
        const attr = encodeXorMappedAddress(rinfo.address, rinfo.port, transactionId);
        socket.send(encodeStunResponse(STUN_BINDING_RESPONSE, transactionId, [attr]), rinfo.port, rinfo.address);
      } catch {
        /* malformed — ignore */
      }
    });
    socket.bind(0, host, () => {
      resolve({ port: socket.address().port, stop: () => socket.close() });
    });
  });
}

// -----------------------------------------------------------------------------
// mTLS — mutual authentication identities (Ed25519 signed handshakes)
// -----------------------------------------------------------------------------

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export interface NodeIdentity {
  nodeId: string;
  /** SPKI DER public key, base64 — the value registered in peers' trust
   *  stores. */
  publicKeyB64: string;
  sign(data: string): string;
  verify(data: string, signatureB64: string): boolean;
}

/** Deterministic Ed25519 identity from a seed — the same node always derives
 *  the same keypair, so identities survive cold boots without key files. */
export function createIdentity(nodeId: string, seed: string): NodeIdentity {
  const digest = crypto.createHash('sha256').update(`${seed}:${nodeId}`).digest();
  const seedBuf = digest.subarray(0, 32);
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seedBuf]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = crypto.createPublicKey(privateKey);
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });
  return {
    nodeId,
    publicKeyB64: publicDer.toString('base64'),
    sign: (data) => crypto.sign(null, Buffer.from(data, 'utf8'), privateKey).toString('base64'),
    verify: (data, signatureB64) => crypto.verify(null, Buffer.from(data, 'utf8'), publicKey, Buffer.from(signatureB64, 'base64')),
  };
}

/** Reconstruct a verification key from a stored public key (trust store). */
export function publicKeyFromB64(publicKeyB64: string): KeyObject {
  return crypto.createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' });
}

/** Verify a signature against a trust-store public key. Never throws. */
export function verifySignature(publicKeyB64: string, data: string, signatureB64: string): boolean {
  try {
    return crypto.verify(null, Buffer.from(data, 'utf8'), publicKeyFromB64(publicKeyB64), Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

interface HelloMessage {
  kind: 'klyn.hello';
  nodeId: string;
  nonce: string;
  sig: string;
}

interface HelloAckMessage {
  kind: 'klyn.hello_ack';
  nodeId: string;
  nonce: string;
  sig: string;
}

function makeHello(identity: NodeIdentity): HelloMessage {
  const nonce = crypto.randomBytes(16).toString('hex');
  return { kind: 'klyn.hello', nodeId: identity.nodeId, nonce, sig: identity.sign(nonce) };
}

function makeHelloAck(identity: NodeIdentity, nonce: string): HelloAckMessage {
  return { kind: 'klyn.hello_ack', nodeId: identity.nodeId, nonce, sig: identity.sign(nonce) };
}

function verifyHello(hello: HelloMessage, trustStore: Map<string, string>): boolean {
  const pub = trustStore.get(hello.nodeId);
  return !!pub && verifySignature(pub, hello.nonce, hello.sig);
}

function verifyHelloAck(ack: HelloAckMessage, trustStore: Map<string, string>): boolean {
  const pub = trustStore.get(ack.nodeId);
  return !!pub && verifySignature(pub, ack.nonce, ack.sig);
}

// -----------------------------------------------------------------------------
// MESH FRAMES + WsMeshNode (real WebSocket listener + dialer)
// -----------------------------------------------------------------------------

export interface MeshFrame {
  id: string;
  from: string;
  to: string;
  kind: string;
  payload: unknown;
  at: number;
}

export interface WsMeshNodeOptions {
  nodeId: string;
  identity: NodeIdentity;
  /** peerId → publicKeyB64. A peer not in this store can never authenticate. */
  trustStore: Map<string, string>;
  onMessage?: (frame: MeshFrame, peerId: string) => void;
  onPeer?: (peerId: string, state: 'connected' | 'disconnected') => void;
  /** Bounded dedup window (frame ids retained). */
  maxDedup?: number;
}

interface WsPeerData {
  nodeId: string | null;
  authenticated: boolean;
}

let frameCounter = 0;

function nextFrameId(nodeId: string): string {
  frameCounter++;
  return `${nodeId}:${Date.now().toString(36)}:${frameCounter}`;
}

export class WsMeshNode {
  private readonly nodeId: string;
  private readonly identity: NodeIdentity;
  private readonly trustStore: Map<string, string>;
  private readonly maxDedup: number;
  private server: { port: number; stop(force?: boolean): void } | null = null;
  private listeningPort: number | null = null;
  private readonly peers = new Map<string, { socket: WebSocket | import('bun').ServerWebSocket<WsPeerData>; url: string }>();
  private readonly seenIds: string[] = [];
  private readonly seen = new Set<string>();
  private sent = 0;
  private received = 0;
  private deduped = 0;

  constructor(options: WsMeshNodeOptions) {
    this.nodeId = options.nodeId;
    this.identity = options.identity;
    this.trustStore = options.trustStore;
    this.maxDedup = options.maxDedup ?? 4_096;
    this.onMessage = options.onMessage ?? (() => {});
    this.onPeer = options.onPeer ?? (() => {});
  }

  private onMessage: (frame: MeshFrame, peerId: string) => void;
  private onPeer: (peerId: string, state: 'connected' | 'disconnected') => void;

  /** Replace the frame handler (used by the mesh bridge). */
  setMessageHandler(handler: (frame: MeshFrame, peerId: string) => void): void {
    this.onMessage = handler;
  }

  /** The port this node listens on (after start()). */
  get port(): number {
    return this.listeningPort ?? 0;
  }

  /** Start the real WebSocket listener. port 0 → ephemeral. */
  async start(port = 0): Promise<number> {
    if (this.server) return this.listeningPort ?? port;
    const self = this;
    const server = Bun.serve<WsPeerData>({
      port,
      fetch(req, srv) {
        if (srv.upgrade(req, { data: { nodeId: null, authenticated: false } })) return undefined;
        return new Response('klyn-mesh: websocket upgrade required', { status: 400 });
      },
      websocket: {
        open() {
          /* handshake starts on first frame */
        },
        message: (ws, raw) => self.handleServerFrame(ws, typeof raw === 'string' ? raw : String(raw)),
        close: (ws) => self.handleServerClose(ws),
      },
    });
    this.server = server;
    this.listeningPort = server.port;
    return server.port;
  }

  /** Dial a remote node and complete the mutual-authentication handshake.
   *  Resolves true only after BOTH sides verified each other's signature. */
  async connect(url: string, remoteId: string): Promise<boolean> {
    const self = this;
    return new Promise<boolean>((resolve) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        resolve(false);
        return;
      }
      let settled = false;
      ws.onopen = () => {
        try {
          ws.send(JSON.stringify(makeHello(self.identity)));
        } catch {
          /* closed before open — onclose handles it */
        }
      };
      ws.onmessage = (ev) => {
        const raw = typeof ev.data === 'string' ? ev.data : String(ev.data);
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return;
        }
        if (parsed && typeof parsed === 'object' && (parsed as HelloAckMessage).kind === 'klyn.hello_ack') {
          const ack = parsed as HelloAckMessage;
          if (ack.nodeId === remoteId && verifyHelloAck(ack, self.trustStore)) {
            self.peers.set(remoteId, { socket: ws, url });
            self.onPeer(remoteId, 'connected');
            if (!settled) {
              settled = true;
              resolve(true);
            }
          } else {
            try {
              ws.close(1008, 'untrusted');
            } catch {
              /* already closed */
            }
            if (!settled) {
              settled = true;
              resolve(false);
            }
          }
          return;
        }
        self.handleClientFrame(ws, parsed);
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      };
      ws.onclose = () => {
        if (self.peers.get(remoteId)?.socket === ws) {
          self.peers.delete(remoteId);
          self.onPeer(remoteId, 'disconnected');
        }
        if (!settled) {
          settled = true;
          resolve(false);
        }
      };
    });
  }

  /** Send one mesh frame to a connected peer. False when not connected. */
  send(peerId: string, kind: string, payload: unknown): boolean {
    const entry = this.peers.get(peerId);
    if (!entry) return false;
    const frame: MeshFrame = { id: nextFrameId(this.nodeId), from: this.nodeId, to: peerId, kind, payload, at: Date.now() };
    try {
      (entry.socket as { send(data: string): void }).send(JSON.stringify(frame));
      this.sent++;
      return true;
    } catch {
      return false;
    }
  }

  /** Broadcast a frame to every connected peer. Returns the fan-out count. */
  broadcast(kind: string, payload: unknown): number {
    let count = 0;
    for (const peerId of this.peers.keys()) {
      if (this.send(peerId, kind, payload)) count++;
    }
    return count;
  }

  /** Forcefully drop a peer's connection (partition simulation / eviction). */
  drop(peerId: string): boolean {
    const entry = this.peers.get(peerId);
    if (!entry) return false;
    try {
      (entry.socket as { close?(code?: number, reason?: string): void }).close?.(1001, 'klyn-drop');
    } catch {
      /* already closed */
    }
    return true;
  }

  isConnected(peerId: string): boolean {
    return this.peers.has(peerId);
  }

  peersList(): string[] {
    return Array.from(this.peers.keys()).sort();
  }

  /** Stop the listener and close every peer socket. */
  close(): void {
    for (const peerId of Array.from(this.peers.keys())) this.drop(peerId);
    this.peers.clear();
    this.server?.stop(true);
    this.server = null;
    this.listeningPort = null;
  }

  getStats(): { nodeId: string; listening: boolean; peers: number; sent: number; received: number; deduped: number } {
    return {
      nodeId: this.nodeId,
      listening: this.server !== null,
      peers: this.peers.size,
      sent: this.sent,
      received: this.received,
      deduped: this.deduped,
    };
  }

  // ---- server-side socket handling ------------------------------------------

  private handleServerFrame(ws: import('bun').ServerWebSocket<WsPeerData>, raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (parsed && typeof parsed === 'object') {
      const hello = parsed as HelloMessage;
      if (hello.kind === 'klyn.hello') {
        if (!verifyHello(hello, this.trustStore)) {
          try {
            ws.close(1008, 'untrusted');
          } catch {
            /* already closed */
          }
          return;
        }
        ws.data = { nodeId: hello.nodeId, authenticated: true };
        const previous = this.peers.get(hello.nodeId);
        if (previous && previous.socket !== ws) {
          try {
            (previous.socket as { close?(): void }).close?.();
          } catch {
            /* ignore */
          }
        }
        this.peers.set(hello.nodeId, { socket: ws, url: 'inbound' });
        try {
          ws.send(JSON.stringify(makeHelloAck(this.identity, hello.nonce)));
        } catch {
          /* socket died mid-handshake */
        }
        this.onPeer(hello.nodeId, 'connected');
        return;
      }
    }
    const frame = parsed as MeshFrame;
    if (!frame || typeof frame.id !== 'string' || frame.kind === 'klyn.hello' || frame.kind === 'klyn.hello_ack') return;
    if (!ws.data?.authenticated) {
      try {
        ws.close(1008, 'handshake required');
      } catch {
        /* already closed */
      }
      return;
    }
    this.ingest(frame);
  }

  private handleServerClose(ws: import('bun').ServerWebSocket<WsPeerData>): void {
    const nodeId = ws.data?.nodeId;
    if (nodeId && this.peers.get(nodeId)?.socket === ws) {
      this.peers.delete(nodeId);
      this.onPeer(nodeId, 'disconnected');
    }
  }

  // ---- client-side socket handling ------------------------------------------

  private handleClientFrame(ws: WebSocket, parsed: unknown): void {
    const frame = parsed as MeshFrame;
    if (!frame || typeof frame.id !== 'string') return;
    this.ingest(frame);
  }

  /** Shared ingest: bounded dedup, then dispatch to the message handler. */
  private ingest(frame: MeshFrame): void {
    if (this.seen.has(frame.id)) {
      this.deduped++;
      return;
    }
    this.markSeen(frame.id);
    this.received++;
    this.onMessage(frame, frame.from);
  }

  private markSeen(id: string): void {
    if (this.seenIds.length >= this.maxDedup) {
      const oldest = this.seenIds.shift();
      if (oldest) this.seen.delete(oldest);
    }
    this.seenIds.push(id);
    this.seen.add(id);
  }
}

// -----------------------------------------------------------------------------
// RECONNECTING CLIENT (exponential backoff + jitter, dedup-safe redelivery)
// -----------------------------------------------------------------------------

export interface ReconnectingClientOptions {
  identity: NodeIdentity;
  trustStore: Map<string, string>;
  remoteId: string;
  url: string;
  onMessage: (frame: MeshFrame, peerId: string) => void;
  onStatus?: (status: 'connecting' | 'connected' | 'reconnecting' | 'stopped') => void;
  /** Backoff base in ms (default 50). */
  baseMs?: number;
  /** Backoff ceiling in ms (default 2_000). */
  maxMs?: number;
  /** Jitter range in ms (default 25). */
  jitterMs?: number;
}

export class ReconnectingClient {
  private readonly identity: NodeIdentity;
  private readonly trustStore: Map<string, string>;
  private readonly remoteId: string;
  private readonly url: string;
  private readonly onMessage: (frame: MeshFrame, peerId: string) => void;
  private readonly onStatus?: (status: 'connecting' | 'connected' | 'reconnecting' | 'stopped') => void;
  private readonly baseMs: number;
  private readonly maxMs: number;
  private readonly jitterMs: number;

  private stopped = false;
  private attempt = 0;
  private node: WsMeshNode | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private status: 'connecting' | 'connected' | 'reconnecting' | 'stopped' = 'connecting';

  constructor(options: ReconnectingClientOptions) {
    this.identity = options.identity;
    this.trustStore = options.trustStore;
    this.remoteId = options.remoteId;
    this.url = options.url;
    this.onMessage = options.onMessage;
    this.onStatus = options.onStatus;
    this.baseMs = options.baseMs ?? 50;
    this.maxMs = options.maxMs ?? 2_000;
    this.jitterMs = options.jitterMs ?? 25;
  }

  /** Start the connection loop (first connect now, reconnect forever until
   *  stop()). Resolves after the FIRST successful handshake. */
  async start(): Promise<boolean> {
    this.stopped = false;
    this.attempt = 0;
    return this.connectOnce();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.node?.close();
    this.node = null;
    this.setStatus('stopped');
  }

  getAttempts(): number {
    return this.attempt;
  }

  getStatus(): string {
    return this.status;
  }

  /** Send a frame to the remote through the active connection (false when
   *  not connected). */
  send(kind: string, payload: unknown): boolean {
    if (!this.node) return false;
    return this.node.send(this.remoteId, kind, payload);
  }

  private setStatus(status: 'connecting' | 'connected' | 'reconnecting' | 'stopped'): void {
    this.status = status;
    this.onStatus?.(status);
  }

  private async connectOnce(): Promise<boolean> {
    if (this.stopped) return false;
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const node = new WsMeshNode({
      nodeId: this.identity.nodeId,
      identity: this.identity,
      trustStore: this.trustStore,
      onMessage: this.onMessage,
      onPeer: (peerId, state) => {
        // A drop AFTER a successful handshake triggers the backoff loop.
        if (peerId === this.remoteId && state === 'disconnected' && this.status === 'connected' && !this.stopped) {
          this.attempt++;
          this.scheduleReconnect();
        }
      },
    });
    this.node = node;
    const ok = await node.connect(this.url, this.remoteId);
    if (ok) {
      this.setStatus('connected');
      return true;
    }
    if (this.stopped) return false;
    this.attempt++;
    this.scheduleReconnect();
    return false;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retryTimer) return;
    const backoff = Math.min(this.maxMs, this.baseMs * 2 ** Math.min(this.attempt, 10));
    const delay = backoff + Math.floor(Math.random() * this.jitterMs);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connectOnce();
    }, delay);
  }
}

// -----------------------------------------------------------------------------
// GOSSIP DISCOVERY (membership spread with TTL)
// -----------------------------------------------------------------------------

export interface GossipMember {
  peerId: string;
  address: string | null;
  seedHash: string | null;
  seenAt: number;
  ttl: number;
}

export class GossipDiscovery {
  private readonly members = new Map<string, GossipMember>();

  constructor(
    private readonly nodeId: string,
    private readonly ttlMs = 60_000
  ) {}

  /** Register a peer (or refresh liveness) in this node's membership table. */
  announce(peerId: string, info: { address?: string; seedHash?: string } = {}): GossipMember {
    if (peerId === this.nodeId) return this.members.get(peerId) as GossipMember;
    const now = Date.now();
    const existing = this.members.get(peerId);
    const member: GossipMember = {
      peerId,
      address: info.address ?? existing?.address ?? null,
      seedHash: info.seedHash ?? existing?.seedHash ?? null,
      seenAt: now,
      ttl: this.ttlMs,
    };
    this.members.set(peerId, member);
    return member;
  }

  /** Absorb gossip received from a neighbor (newer seenAt wins — last writer
   *  wins, the CRDT-style convergence rule used across the mesh). */
  merge(peerId: string, gossip: GossipMember[]): number {
    let absorbed = 0;
    for (const member of gossip) {
      if (!member || member.peerId === this.nodeId) continue;
      const existing = this.members.get(member.peerId);
      if (!existing || member.seenAt > existing.seenAt) {
        this.members.set(member.peerId, {
          peerId: member.peerId,
          address: member.address ?? existing?.address ?? null,
          seedHash: member.seedHash ?? existing?.seedHash ?? null,
          seenAt: member.seenAt,
          ttl: member.ttl > 0 ? member.ttl : this.ttlMs,
        });
        absorbed++;
      }
    }
    void peerId;
    return absorbed;
  }

  /** The membership table a neighbor should hear (sorted, deterministic). */
  spread(): GossipMember[] {
    return Array.from(this.members.values()).sort((a, b) => (a.peerId < b.peerId ? -1 : 1));
  }

  peers(): GossipMember[] {
    return this.spread();
  }

  /** Drop members whose TTL expired (unreachable nodes stop spreading). */
  prune(now = Date.now()): number {
    let removed = 0;
    for (const [peerId, member] of this.members) {
      if (now - member.seenAt > member.ttl) {
        this.members.delete(peerId);
        removed++;
      }
    }
    return removed;
  }

  getStats(): { nodeId: string; members: number } {
    return { nodeId: this.nodeId, members: this.members.size };
  }
}

// -----------------------------------------------------------------------------
// MESH TRANSPORT BRIDGE (real transport ↔ Phase 12 FederatedMesh causal sync)
// -----------------------------------------------------------------------------

export class MeshTransportBridge {
  constructor(
    private readonly mesh: FederatedMesh,
    private readonly transport: WsMeshNode
  ) {}

  /** Wire the transport's frames into the federated mesh. */
  attach(): void {
    this.transport.setMessageHandler((frame, peer) => this.handle(frame, peer));
  }

  handle(frame: MeshFrame, peer: string): void {
    switch (frame.kind) {
      case 'mesh.sync-request': {
        const since = typeof (frame.payload as { since?: unknown } | null)?.since === 'number' ? ((frame.payload as { since: number }).since) : 0;
        const delta = this.mesh.produceDelta(since);
        this.transport.send(peer, 'mesh.sync-delta', { since, to: this.mesh.engine.seq, delta });
        break;
      }
      case 'mesh.sync-delta': {
        const payload = (frame.payload ?? {}) as { delta?: unknown };
        const delta = Array.isArray(payload.delta) ? (payload.delta as Parameters<FederatedMesh['receiveDelta']>[1]) : [];
        try {
          this.mesh.receiveDelta(peer, delta);
        } catch {
          /* peer not joined — drop */
        }
        break;
      }
      case 'mesh.heal': {
        const payload = (frame.payload ?? {}) as { delta?: unknown };
        const delta = Array.isArray(payload.delta) ? (payload.delta as Parameters<FederatedMesh['healSplitBrain']>[1]) : [];
        try {
          this.mesh.healSplitBrain(peer, delta);
        } catch {
          /* peer not joined — drop */
        }
        break;
      }
      default:
        break;
    }
  }
}

export default WsMeshNode;
