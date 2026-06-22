// External services & accounts this app depends on — a quick-reference list
// rendered on the dashboard so you can jump to a console and know which login
// to use. Edit this file to add/change entries; never store passwords here.

export interface ExternalService {
  /** Display name, e.g. "Northflank". */
  name: string;
  /** Console/dashboard URL opened in a new tab. */
  url: string;
  /** Which login to use, e.g. "GitHub · bryanbernigen". No passwords. */
  account: string;
  /** Optional short note (what it's used for). */
  note?: string;
}

/** GitHub repo this app is built from — used for commit links. */
export const GITHUB_REPO_URL = 'https://github.com/bryanbernigen/auto-checker';

export const externalServices: ExternalService[] = [
  {
    name: 'Northflank',
    url: 'https://app.northflank.com/t/bryanbernigens-team/project/auto-checker',
    account: 'GitHub · bryanbernigen',
    note: 'Hosting — app, WAHA, and Postgres',
  },
  {
    name: 'UptimeRobot',
    url: 'https://dashboard.uptimerobot.com/monitors',
    account: 'GitHub · bryanbernigen',
    note: 'Uptime monitoring of /api/health',
  },
];
