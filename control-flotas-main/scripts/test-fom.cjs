const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { spawnSync } = require('node:child_process');
const project = path.resolve(__dirname, '..');
const output = path.join(project, '.fom-test-build');
fs.mkdirSync(output, { recursive: true });
for (const name of ['session', 'gps']) {
  const source = fs.readFileSync(path.join(project, 'src/fom', `${name}.ts`), 'utf8');
  fs.writeFileSync(path.join(output, `${name}.js`), ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText);
}
const result = spawnSync(process.execPath, ['--test', 'test/fom-session.test.cjs', 'test/fom-gps.test.cjs'], { cwd: project, stdio: 'inherit' });
process.exit(result.status ?? 1);
