// Fill the menu with N items (default 20000) so that a backfill takes real time.
import { open } from '../src/db.js';

const n = Number(process.argv[2] ?? 20000);
const db = open();
const dishes = ['Phở bò', 'Bún chả', 'Cơm tấm', 'Bánh xèo', 'Gỏi cuốn', 'Cà phê sữa', 'Trà đá', 'Chè ba màu'];
const cols = new Set(db.prepare('PRAGMA table_info(menu_items)').all().map((c) => c.name));
const fields = ['name', ...(cols.has('price') ? ['price'] : []), ...(cols.has('price_vnd') ? ['price_vnd'] : [])];
const insert = db.prepare(`INSERT INTO menu_items (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`);
db.exec('BEGIN');
for (let i = 0; i < n; i++) {
  // 15.0 .. 250.0 thousand dong, half-thousand steps — the float unit IA#2 removes
  const price = (30 + Math.floor(Math.random() * 471)) / 2;
  insert.run(`${dishes[i % dishes.length]} #${i + 1}`, ...(cols.has('price') ? [price] : []), ...(cols.has('price_vnd') ? [Math.round(price * 1000)] : []));
}
db.exec('COMMIT');
console.log(`seeded ${n} menu items`);
