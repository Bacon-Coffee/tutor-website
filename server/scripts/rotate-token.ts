import { adminUrl, config } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { rotateAdminToken } from '../src/repo/owners.js';

const ownerId = process.argv[2];

if (!ownerId) {
  console.error('用法：npm run rotate-token -- <owner-id>');
  console.error('例如：npm run rotate-token -- xavier');
  process.exit(1);
}

const db = openDatabase(config.databaseFile);
const token = rotateAdminToken(db, ownerId);

console.log(`✅ ${ownerId} 的管理链接已更换，旧链接立即失效。`);
console.log(`   新管理链接：${adminUrl(token)}`);
