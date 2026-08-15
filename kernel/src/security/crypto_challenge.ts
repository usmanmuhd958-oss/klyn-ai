import crypto from 'node:crypto';

export function createChallengePayload(sessionKeyHex) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const hmac = crypto.createHmac('sha256', Buffer.from(sessionKeyHex, 'hex'));
  hmac.update(nonce);
  const expectedResponse = hmac.digest('hex');
  return { nonce, expectedResponse };
}

export function verifyChallengeResponse(nonce, response, sessionKeyHex) {
  const hmac = crypto.createHmac('sha256', Buffer.from(sessionKeyHex, 'hex'));
  hmac.update(nonce);
  const calculated = hmac.digest('hex');

  // crypto.timingSafeEqual THROWS when the buffers differ in length, which an
  // attacker can trigger by sending a different-length response to turn every
  // attempt into an unhandled 500. Length-check first, then compare in
  // constant time — same security, no exception surface.
  const a = Buffer.from(calculated, 'hex');
  const b = Buffer.from(String(response ?? ''), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
