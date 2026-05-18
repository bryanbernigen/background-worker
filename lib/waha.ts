export class WahaClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string = '') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
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
      return data.success === true;
    } catch (err) {
      console.error('[WAHA] Error:', err);
      return false;
    }
  }
}
