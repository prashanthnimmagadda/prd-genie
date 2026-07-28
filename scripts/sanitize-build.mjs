import fs from 'node:fs';
import path from 'node:path';

const assets = path.resolve(import.meta.dirname, '../dist/client/assets');
if (!fs.existsSync(assets)) process.exit(0);

for (const name of fs.readdirSync(assets)) {
  if (!name.endsWith('.js')) continue;
  const file = path.join(assets, name);
  const source = fs.readFileSync(file, 'utf8');
  const sanitized = source.replaceAll(String.fromCodePoint(0x2014), '\\u2014');
  if (sanitized !== source) fs.writeFileSync(file, sanitized);
}
