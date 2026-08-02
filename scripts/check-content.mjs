import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const forbiddenProductTerm = String.fromCharCode(99, 111, 100, 101, 120);
const longDash = String.fromCodePoint(0x2014);
const protectedTerms = ['SU9IIFNhbGVzSHVi', 'U2FsZXNIdWI='].map((value) =>
  Buffer.from(value, 'base64').toString('utf8').toLowerCase(),
);
const protectedHashes = [
  ['7405dd0615d80eb3f83380cc9c995f7e', '53200d24498e83130eb60fcca5dde4ae'].join(''),
  ['9f3bea4a51614c360360d7c5dc738d62', '0c52ec76baa8fe68b17dd9995ad5847f'].join(''),
  ['a24fb1ea7496de0dffaf9d9940d77f31', 'e987a235b2b28606e6b4965fa5e56eaf'].join(''),
];
const secretPatterns = [
  /sk-(?:proj-)?(?=[A-Za-z0-9_-]{32,})(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+/,
  /AIza[0-9A-Za-z_-]{25,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
const sourceSecretPattern = /(?:api[_-]?key|token|secret|password)\s*[:=]\s*["'][^"'$\s]{12,}["']/i;
const textExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.sql',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function inventory() {
  const source = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean);
  const generated = ['dist', 'reports']
    .flatMap((directory) => walk(path.join(root, directory)))
    .map((file) => path.relative(root, file));
  return [...new Set([...source, ...generated])];
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

const failures = [];
for (const relative of inventory()) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
  const digest = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (protectedHashes.includes(digest)) failures.push(`${relative}: protected source hash`);
  if (relative.startsWith('.env') && relative !== '.env.example') {
    failures.push(`${relative}: environment file`);
  }
  if (!textExtensions.has(path.extname(relative).toLowerCase())) continue;
  const content = fs.readFileSync(file, 'utf8');
  const lower = content.toLowerCase();
  if (lower.includes(forbiddenProductTerm)) failures.push(`${relative}: reserved product term`);
  if (content.includes(longDash)) failures.push(`${relative}: long dash character`);
  for (const term of protectedTerms) {
    if (lower.includes(term)) failures.push(`${relative}: protected organisation term`);
  }
  for (const pattern of secretPatterns) {
    if (pattern.test(content)) failures.push(`${relative}: possible secret`);
  }
  if (!relative.startsWith('dist/') && sourceSecretPattern.test(content)) {
    failures.push(`${relative}: possible secret`);
  }
}

const metadata = [
  git(['log', '--all', '--format=%B']),
  git(['for-each-ref', '--format=%(refname) %(subject)']),
].join('\n');
if (metadata.toLowerCase().includes(forbiddenProductTerm)) {
  failures.push('Git metadata: reserved product term');
}
if (metadata.includes(longDash)) failures.push('Git metadata: long dash character');
for (const term of protectedTerms) {
  if (metadata.toLowerCase().includes(term)) failures.push('Git metadata: protected term');
}

for (const commit of git(['rev-list', '--all']).trim().split('\n').filter(Boolean)) {
  const paths = git(['ls-tree', '-r', '--name-only', '-z', commit]).split('\0').filter(Boolean);
  for (const relative of paths) {
    if (relative.startsWith('.env') && relative !== '.env.example') {
      failures.push(`Git history ${commit.slice(0, 12)} ${relative}: environment file`);
    }
    if (!textExtensions.has(path.extname(relative).toLowerCase())) continue;
    let content;
    try {
      content = execFileSync('git', ['show', `${commit}:${relative}`], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch {
      failures.push(`Git history ${commit.slice(0, 12)} ${relative}: could not be scanned`);
      continue;
    }
    const lower = content.toLowerCase();
    if (lower.includes(forbiddenProductTerm)) {
      failures.push(`Git history ${commit.slice(0, 12)} ${relative}: reserved product term`);
    }
    if (content.includes(longDash)) {
      failures.push(`Git history ${commit.slice(0, 12)} ${relative}: long dash character`);
    }
    for (const term of protectedTerms) {
      if (lower.includes(term)) {
        failures.push(`Git history ${commit.slice(0, 12)} ${relative}: protected term`);
      }
    }
    for (const pattern of secretPatterns) {
      if (pattern.test(content)) {
        failures.push(`Git history ${commit.slice(0, 12)} ${relative}: possible secret`);
      }
    }
    if (sourceSecretPattern.test(content)) {
      failures.push(`Git history ${commit.slice(0, 12)} ${relative}: possible secret`);
    }
  }
}

if (failures.length > 0) {
  console.error('Content guard failed:');
  for (const failure of [...new Set(failures)]) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Content guard passed.');
