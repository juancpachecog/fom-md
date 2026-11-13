'use strict'
const fs=require('node:fs'),crypto=require('node:crypto')
const {generate:previous}=require('./issue-831-publication.cjs')
const sha=s=>crypto.createHash('sha256').update(s).digest('hex')
// Fresh WEB contract; keep the API829 baseline and its receipt unchanged.
function generate(template){
 let s=previous(template)
 if(sha(s)!=='0660d47d7c18f46717219f0e972d1cc8aa1f5bd1bd47dcc9fce8789a7f05d194')throw Error('baseline gate')
 s=s.replace(/\b831\b/g,'832')
  .replaceAll('8de03d9d75674ebf2b19b039de2b7005daa43f6c','57cf48ae2d842c7e33d97a01a699ac3471c7bedc')
  .replaceAll('issue-832-gps-test-8de03d9','issue-832-company-context-57cf48a')
  .replaceAll('gps-test-8de03d9.tar.gz','company-context-57cf48a.tar.gz')
  .replace(/^OLD_ROOT = .*$/m,"OLD_ROOT = Path('/var/www/fom-web/releases/issue-831-gps-test-8de03d9')")
  .replaceAll('c200a4fa757a20a059637d9e5381ad78e2030dbd3f9283ec2f411990e92870c8','eb12d8a227fc85f158795936047560113743ca492fd9b6eb4810fda8b2e13c2d')
  .replaceAll('ed48da4acd695224aad30ab9d4ca1bdb5fa69b8faff4e5882684b7e55c9c233e','95dc08617b5519abcc3ed036d6b32022c6f79b34caea15c63fcfba7f5f0b4aa9')
 return s
}
module.exports={generate}
if(require.main===module){const s=generate(fs.readFileSync(process.argv[2],'utf8'));fs.writeFileSync(process.argv[3],s,{flag:'wx'});console.log(sha(s))}
