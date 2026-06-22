export class WahaClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string = '') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  /**
   * Reads the WhatsApp session lifecycle from WAHA. Only `status === 'WORKING'`
   * (with a populated `me`) means the session is authenticated and can actually
   * send — a running WAHA with an expired session reports `SCAN_QR_CODE`.
   */
  async getSessionStatus(session: string = 'default'): Promise<{ status: string; me: { id?: string; pushName?: string } | null }> {
    const headers: Record<string, string> = {};
    if (this.apiKey) headers['x-api-key'] = this.apiKey;
    const res = await fetch(`${this.baseUrl}/api/sessions/${session}`, { headers });
    if (!res.ok) throw new Error(`WAHA session status ${res.status}`);
    const data = await res.json();
    return { status: typeof data?.status === 'string' ? data.status : 'UNKNOWN', me: data?.me ?? null };
  }

  async sendText(phone: string, text: string): Promise<boolean> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.apiKey) {
        headers['x-api-key'] = this.apiKey;
      }

      const res = await fetch(`${this.baseUrl}/api/sendText`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          session: 'default',
          chatId: `${phone}@c.us`,
          text,
        }),
      });

      const data = await res.json();
      return res.ok && !!data;
    } catch (err) {
      console.error('[WAHA] Error:', err);
      return false;
    }
  }
}
