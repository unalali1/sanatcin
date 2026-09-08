import fs from 'node:fs/promises';
import path from 'node:path';
import PHPParser from 'php-parser';

const engine = new PHPParser.Engine({ parser: { php7: true }, ast: { withPositions: true } });
const wordpressDir = path.resolve('../wordpress');

async function files(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...await files(full));
    if (entry.isFile() && entry.name.endsWith('.php')) output.push(full);
  }
  return output;
}

for (const file of await files(wordpressDir)) {
  engine.parseCode(await fs.readFile(file, 'utf8'), file);
}
console.log('WordPress PHP sözdizimi doğrulandı.');

