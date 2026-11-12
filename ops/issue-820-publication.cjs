'use strict'
// Nuevo contrato WEB; conserva la guarda de perfil conectado de la recuperación819.
const fs = require('node:fs'), crypto = require('node:crypto')
const { generate: connectedPublisher } = require('./issue-819-publication.cjs')
const sha = s => crypto.createHash('sha256').update(s).digest('hex')
function generate(template) {
  let s = connectedPublisher(template)
  if (sha(s) !== 'bc74e49b92ca3f227b08d6654ed8f9d25894b1666622099b5d9fda514c7130f0') throw Error('connected publisher pin')
  s = s.replace(/\b819\b/g, '820')
    .replaceAll('issue-820-route-connected-7e2e95d', 'issue-820-route-direction-4a8809c')
    .replaceAll('7e2e95da529045eef681bf0a0e1f8787e130155c', '4a8809ce87cf49ce91532155ce08a005eae7f5a0')
    .replaceAll('route-connected-7e2e95d.tar.gz', 'route-direction-4a8809c.tar.gz')
    .replaceAll("OLD_ROOT = Path('/var/www/fom-web/releases/issue-815-live-8513d2f')", "OLD_ROOT = Path('/var/www/fom-web/releases/issue-819-route-connected-7e2e95d')")
    .replaceAll('a37d1afe2d5f3646cbbdd57be255b61656cf69180a0cd8eef37dd8471a2fee85', 'e89ac395b930b4774b0131774e8bcf15a7e6d4f29cb14161339973c63f842620')
    .replaceAll('2f600ad2baf45f6cff0fc78da2ca21539d5f1d327bd8b5a2e11d2221f8e1948f', 'ecec10e755c942b98a1cbcb05137ab672da35e5a12509ab655f1f6780199a4c9')
  if (!s.includes("'connected_profile_gate'") || !s.includes("value.get('issue') == 817")) throw Error('publication guards missing')
  return s
}
module.exports = { generate }
if (require.main === module) {
  if (process.argv.length !== 4) throw Error('template and NEW output path required')
  const s = generate(fs.readFileSync(process.argv[2], 'utf8'))
  fs.writeFileSync(process.argv[3], s, { flag: 'wx', mode: 0o600 })
  console.log(sha(s))
}
