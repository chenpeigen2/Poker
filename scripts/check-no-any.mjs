import ts from 'typescript';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const targets = ['packages/domain/src', 'packages/engine/src', 'packages/ai/src', 'apps/web/src', 'scripts'];

const files = [];
const walk = (dir) => {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry)) {
      files.push(full);
    }
  }
};
for (const target of targets) walk(join(root, target));

const violations = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
      violations.push(`${relative(root, file)}:${line + 1}:${character + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (violations.length > 0) {
  console.error(`发现 ${violations.length} 处 any：`);
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log(`no-any 检查通过：扫描 ${files.length} 个文件，零命中。`);
