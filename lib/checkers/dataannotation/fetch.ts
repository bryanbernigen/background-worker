export async function fetchDataAnnotationPage(cookie: string): Promise<string> {
  // Use local example file when DATAANNOTATION_USE_LOCAL=true
  if (process.env.DATAANNOTATION_USE_LOCAL === 'true') {
    try {
      const { readFileSync, existsSync } = await import('node:fs');
      const { join } = await import('node:path');
      const examplePath = join(process.cwd(), 'example_response.html');
      if (existsSync(examplePath)) {
        return readFileSync(examplePath, 'utf8');
      }
    } catch {
      // Fall through to live URL
    }
  }

  const res = await fetch('https://app.dataannotation.tech/workers/projects', {
    headers: {
      'Cookie': cookie,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
  }

  return res.text();
}
