export interface SessionPayload {
  username: string;
  exp: number;
}

const encoder = new TextEncoder();

async function createHmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function verifyHmac(data: string, sig: string, secret: string): Promise<boolean> {
  const expected = await createHmac(data, secret);
  return expected === sig;
}

export async function createSessionToken(username: string): Promise<string> {
  const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod';
  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = JSON.stringify({ username, exp });
  const sig = await createHmac(payload, JWT_SECRET);
  return btoa(payload) + '.' + sig;
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod';
    const [payloadB64, sig] = token.split('.');
    if (!payloadB64 || !sig) return null;
    const valid = await verifyHmac(payloadB64, sig, JWT_SECRET);
    if (!valid) return null;
    const { username, exp } = JSON.parse(atob(payloadB64));
    if (Date.now() > exp) return null;
    return { username, exp };
  } catch {
    return null;
  }
}
