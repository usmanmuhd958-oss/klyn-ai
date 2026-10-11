import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import test from 'node:test';
import {
  Pkcs11Ed25519Driver,
  UnixSignerAgent,
} from '../src/signer-agent.js';

function signerRequest(socketPath: string, request: unknown): Promise<unknown> {
  const body = Buffer.from(JSON.stringify(request), 'utf8');
  const frame = Buffer.alloc(4 + body.length);
  frame.writeUInt32BE(body.length, 0);
  body.copy(frame, 4);
  return new Promise((resolve, reject) => {
    const socket = connect({ path: socketPath });
    let bytes = Buffer.alloc(0);
    let expected: number | undefined;
    socket.once('error', reject);
    socket.once('connect', () => socket.write(frame));
    socket.on('data', (chunk: Buffer) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (expected === undefined && bytes.length >= 4) {
        const length = bytes.readUInt32BE(0);
        expected = length + 4;
      }
      if (expected !== undefined && bytes.length >= expected) {
        try {
          resolve(JSON.parse(bytes.subarray(4, expected).toString('utf8')) as unknown);
        } catch (error) { reject(error); }
        socket.destroy();
      }
    });
  });
}

test('external signer agent protocol keeps private material behind injected HSM driver', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'kel-signer-agent-'));
  const socketPath = join(directory, 'signer.sock');
  const token = 'a1'.repeat(32);
  const pair = generateKeyPairSync('ed25519');
  const provider = new Pkcs11Ed25519Driver(
    'hsm-key-1',
    '7',
    pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32),
    async (message) => new Uint8Array(sign(null, message, pair.privateKey)),
  );
  const agent = new UnixSignerAgent({
    socketPath,
    authTokenHex: token,
    backend: provider,
    maxConnections: 2,
  });
  try {
    await agent.listen();
    const info = await signerRequest(socketPath, {
      version: 1,
      token,
      method: 'signer.info',
      params: {},
    }) as { result: { keyId: string; keyEpoch: string; publicKeyHex: string } };
    assert.equal(info.result.keyId, 'hsm-key-1');
    assert.equal(info.result.keyEpoch, '7');
    assert.equal(info.result.publicKeyHex.length, 64);

    const message = Buffer.from('KEL DSSE signer integration test');
    const signed = await signerRequest(socketPath, {
      version: 1,
      token,
      method: 'signer.sign',
      params: { keyId: 'hsm-key-1', payloadBase64: message.toString('base64') },
    }) as { result: { signatureBase64: string } };
    const signature = Buffer.from(signed.result.signatureBase64, 'base64');
    assert.equal(verify(null, message, pair.publicKey, signature), true);

    const rejected = await signerRequest(socketPath, {
      version: 1,
      token: 'bad-token',
      method: 'signer.info',
      params: {},
    }) as { error?: { code: string } };
    assert.equal(rejected.error?.code, 'unauthenticated');
  } finally {
    await agent.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
