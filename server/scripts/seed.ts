import { adminUrl, config, publicUrl } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { createOwner, type CreateOwnerInput } from '../src/repo/owners.js';

/** 两个初始用户。名字和介绍之后都能在后台改，这里只是占位。 */
const PEOPLE: (CreateOwnerInput & { sampleRules: [number, number, number][] })[] = [
  {
    id: 'xavier',
    displayName: '我',
    bio: '有空就聊聊',
    // [星期, 开始分钟, 结束分钟]，0=周日
    sampleRules: [
      [2, 19 * 60, 21 * 60],
      [6, 10 * 60, 12 * 60],
    ],
  },
  {
    id: 'ielts',
    displayName: '朋友',
    bio: '雅思口语对练',
    sampleRules: [
      [1, 19 * 60, 21 * 60],
      [3, 19 * 60, 21 * 60],
      [6, 14 * 60, 17 * 60],
    ],
  },
];

const db = openDatabase(config.databaseFile);
const exists = db.prepare('SELECT 1 FROM owners WHERE id = ?');
const addRule = db.prepare(
  'INSERT INTO availability_rules (owner_id, weekday, start_minute, end_minute) VALUES (?, ?, ?, ?)',
);

console.log(`数据库：${config.databaseFile}\n`);

for (const { sampleRules, ...person } of PEOPLE) {
  if (exists.get(person.id)) {
    console.log(`⏭  ${person.id} 已存在，跳过。要换管理链接请用：npm run rotate-token -- ${person.id}\n`);
    continue;
  }

  const { token } = createOwner(db, person);
  for (const [weekday, start, end] of sampleRules) addRule.run(person.id, weekday, start, end);

  console.log(`✅ ${person.displayName}（${person.id}）`);
  console.log(`   管理链接：${adminUrl(token)}`);
  console.log(`   公开链接：${publicUrl(person.id)}\n`);
}

console.log('⚠️  管理链接只在这里显示这一次，数据库里只存哈希。请立刻保存好。');
console.log('   拿到链接的人就能改这个人的空闲时间，不要外发。');
