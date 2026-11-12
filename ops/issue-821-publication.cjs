'use strict'
// Nuevo contrato: añade números sin modificar el perfil conectado ni las flechas.
const fs = require('node:fs'), crypto = require('node:crypto')
const { generate: directionPublisher } = require('./issue-820-publication.cjs')
const sha = s => crypto.createHash('sha256').update(s).digest('hex')
function generate(template) {
  let s = directionPublisher(template)
  if (sha(s) !== '10bbb78bf980bbba7fd4405d31230a1fd39f41ccd1f207a27cc88d0e02ee866f') throw Error('publisher baseline pin')
  s = s.replace(/\b820\b/g, '821')
    .replaceAll('issue-821-route-direction-4a8809c', 'issue-821-stop-numbers-dcc1f36')
    .replaceAll('4a8809ce87cf49ce91532155ce08a005eae7f5a0', 'dcc1f3614e268ceebeece36a94f461778aecad25')
    .replaceAll('route-direction-4a8809c.tar.gz', 'stop-numbers-dcc1f36.tar.gz')
    .replaceAll("OLD_ROOT = Path('/var/www/fom-web/releases/issue-819-route-connected-7e2e95d')", "OLD_ROOT = Path('/var/www/fom-web/releases/issue-820-route-direction-4a8809c')")
    .replaceAll('e89ac395b930b4774b0131774e8bcf15a7e6d4f29cb14161339973c63f842620', '68b48169d9f2f521a4baa15fb52d5bccda765ce8eccd872b87c5a613d8a66cd8')
    .replaceAll('ecec10e755c942b98a1cbcb05137ab672da35e5a12509ab655f1f6780199a4c9', '88cefec74682584ec9e863a2f3cf69691422bdb36a017094850e1cbf39e557b8')
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
