'use strict'
// Generate the bounded WEB publication contract; no host or deployment effects.
const fs=require('node:fs'),crypto=require('node:crypto')
const {generate:previous}=require('./issue-825-publication.cjs')
const sha=s=>crypto.createHash('sha256').update(s).digest('hex')
function generate(template){
 let s=previous(template)
 if(sha(s)!=='516cc2fd78e1bc0b1c85baa1b0ef609b744bc19852c94e749f16c5239fa06b76')throw Error('baseline gate')
 s=s.replace(/\b825\b/g,'827')
  .replaceAll('5c699e028cbac8ccafe0e8479ef02fe5ec92c8a7','015fe5b139b92827ced93aa3f944d8b44681551f')
  .replaceAll('issue-827-gps-inventory-5c699e0','issue-827-coban-identification-015fe5b')
  .replaceAll('gps-inventory-5c699e0.tar.gz','coban-identification-015fe5b.tar.gz')
  .replace(/^OLD_ROOT = .*$/m,"OLD_ROOT = Path('/var/www/fom-web/releases/issue-825-gps-inventory-5c699e0')")
  .replaceAll('04785ceb27a6af4a4bbde02deb955738a216cecdb371bc7f99d663733b66aeab','6526d4278770fe1c3d42bf1d3dad43928f909a510310610f5e0bff9310a14cd3')
  .replaceAll('4dcd30b7d4f19e67f3b7e9d39d9f0d788363376694362a109fd4202692311ecc','a3e27bf57f3d58c92cc25656e7f7f1d1bc3d53c08fb1aba63a6f88981a527833')
  .replaceAll('619cada70e0cafbe493fd26611610819ffe571a0','569cba2b298342de8f959049a1ba402db7641c2a')
 return s
}
module.exports={generate}
if(require.main===module){const s=generate(fs.readFileSync(process.argv[2],'utf8'));fs.writeFileSync(process.argv[3],s,{flag:'wx'});console.log(sha(s))}
