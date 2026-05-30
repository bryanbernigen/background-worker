import { runMigrations } from '../lib/db/migrate';

runMigrations()
  .then(() => { console.log('migrations done'); process.exit(0); })
  .catch(err => { console.error(err); process.exit(1); });
