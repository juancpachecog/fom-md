'use strict'
const fs = require('node:fs'), crypto = require('node:crypto')
const { generate: previous } = require('./issue-833-publication.cjs')
const sha = s => crypto.createHash('sha256').update(s).digest('hex')
function generate(template) {
  let s = previous(template)
  if (sha(s) !== '8b3ccf7973b222a3aa718bf2acd028702830b4757d328e556221e5575afe14d1') throw Error('baseline gate')
  s = s.replace(/\b833\b/g, '835').replace(/\b829\b/g, '835')
    .replaceAll('238e0c0bb91b8a82828e349d77324e788b98c6ca', '27cf0ba827d5b1c8b6268f253901be7bdad5b3eb')
    .replaceAll('33264fa17e63b2b11d04c1413ca37d10d172d71d', 'ebe6bb7a55780efa5ee604618bac07a245af724a')
    .replaceAll('issue-835-daily-km-238e0c0', 'issue-835-admin-30s-27cf0ba')
    .replaceAll('daily-km-238e0c0.tar.gz', 'admin-30s-27cf0ba.tar.gz')
    .replace(/^OLD_ROOT = .*$/m, "OLD_ROOT = Path('/var/www/fom-web/releases/issue-833-daily-km-238e0c0')")
    .replaceAll('b9e177c29265c82b79d9097be01c0b17e5353fe93f23957275a940d654406bb1', 'dee485d977c110cd11a8223e7cbe231f353043f88941c0382559eeb5be7a4697')
    .replaceAll('10f861ac88bb3d79fbde77eeac6c46d7f89c18fffc2e6fc2b85dcf8210ea630a', '3dadf35b4cd1422f021005cf4f526c001e6cab753213253e7b823077f5eac46b')
  return s
}
module.exports = { generate }
if (require.main === module) {
  const text = generate(fs.readFileSync(process.argv[2], 'utf8'))
  fs.writeFileSync(process.argv[3], text, { flag: 'wx' }); console.log(sha(text))
}
