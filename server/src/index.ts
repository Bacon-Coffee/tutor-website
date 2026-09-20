import { buildApp } from './app.js';
import { config } from './config.js';
import { openDatabase } from './db/index.js';

const db = openDatabase(config.databaseFile);
const app = buildApp({ db, logger: true });

app.addHook('onClose', async () => db.close());

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void app.close());
}
