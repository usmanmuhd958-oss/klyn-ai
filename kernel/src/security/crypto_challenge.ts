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
  return crypto.timingSafeEqual(Buffer.from(calculated, 'hex'), Buffer.from(response, 'hex'));
}
