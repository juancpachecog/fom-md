const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const project = path.resolve(__dirname, '..');
const app = JSON.parse(fs.readFileSync(path.join(project, 'app.json'), 'utf8'));
const router = app.expo.plugins.find(p => Array.isArray(p) && p[0] === 'expo-router');
assert.equal(router[1].root, './src/fom-app');
const baseline = '9eebb32446fb5dda52ff961db67069df4e2ae574';
const protectedPaths = ['src/app', 'src/auth', 'src/session', 'src/services', 'src/types', 'supabase'];
const changed = execFileSync('git', ['diff', '--name-only', baseline, '--', ...protectedPaths], { cwd: project, encoding: 'utf8' }).trim();
assert.equal(changed, '', 'Existing demo code/data sources must remain unchanged in this phase');
const imports = require('typescript');
const visited = new Set();
function visit(file) {
  if (visited.has(file)) return; visited.add(file);
  const source = imports.createSourceFile(file, fs.readFileSync(file, 'utf8'), imports.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (!imports.isImportDeclaration(statement) && !imports.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier?.text; if (!specifier) continue;
    assert.ok(!specifier.includes('supabase'), 'FOM route imports Supabase');
    const base = specifier.startsWith('@/') ? path.join(project, 'src', specifier.slice(2))
      : specifier.startsWith('.') ? path.resolve(path.dirname(file), specifier) : null;
    if (!base) continue;
    const relative = path.relative(path.join(project, 'src'), base).replaceAll('\\', '/');
    assert.ok(!/^(app|auth|session|services)(\/|$)/.test(relative), 'FOM route reaches a legacy/demo domain');
    const resolved = [base + '.ts', base + '.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx')].find(f => fs.existsSync(f));
    if (resolved) visit(resolved);
  }
}
for (const file of fs.readdirSync(path.join(project, 'src/fom-app'))) if (/\.tsx$/.test(file)) visit(path.join(project, 'src/fom-app', file));
const exported = fs.readdirSync(path.join(project, '.fom-preview')).filter(f => f.endsWith('.html')).sort();
assert.deepEqual(exported, ['+not-found.html', '_sitemap.html', 'index.html', 'login.html', 'password.html'].sort());
console.log('FOM_NATIVE_BOUNDARY=PASS legacySourcesUnchanged=true demoImports=false routes=5');
