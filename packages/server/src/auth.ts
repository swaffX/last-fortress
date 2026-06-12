import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.TOKEN_SECRET ?? randomBytes(32).toString('hex');

/** Anonymous device token: "<id>.<hmac(id)>". No PII, no password. */
export function issueToken(): { token: string; deviceId: string } {
  const deviceId = randomBytes(16).toString('hex');
  return { token: `${deviceId}.${sign(deviceId)}`, deviceId };
}

export function verifyToken(token: string): string | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const deviceId = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = sign(deviceId);
  if (mac.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(expected, 'hex'))) return null;
  } catch { return null; }
  return deviceId;
}

function sign(deviceId: string): string {
  return createHmac('sha256', SECRET).update(deviceId).digest('hex');
}
