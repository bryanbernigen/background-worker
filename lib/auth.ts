export interface SessionPayload {
  username: string;
  role: 'admin' | 'guest';
  exp: number;
}

const encoder = new TextEncoder();

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const raw = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return raw.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function toBase64url(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromBase64url(str: string): string {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded);
}

export async function createSessionToken(username: string, role: 'admin' | 'guest' = 'admin'): Promise<string> {
  const secret = process.env.JWT_SECRET || 'dev-secret-change-in-prod';
  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = JSON.stringify({ username, role, exp });
  const payloadB64 = toBase64url(payload);
  const sig = await hmac(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const secret = process.env.JWT_SECRET || 'dev-secret-change-in-prod';
    const [payloadB64, sig] = token.split('.');
    if (!payloadB64 || !sig) return null;

    const expectedSig = await hmac(payloadB64, secret);
    if (sig !== expectedSig) return null;

    const { username, role, exp } = JSON.parse(fromBase64url(payloadB64));
    if (Date.now() > exp) return null;
    return { username, role: role === 'guest' ? 'guest' : 'admin', exp };
  } catch {
    return null;
  }
}
