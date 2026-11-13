'use strict'
const fs=require('node:fs'),crypto=require('node:crypto')
const {generate:previous}=require('./issue-827-publication.cjs')
const sha=s=>crypto.createHash('sha256').update(s).digest('hex')
// Fresh WEB-only contract. Does not connect to a host or activate a site.
function generate(template){
 let s=previous(template)
 if(sha(s)!=='123f615e89f6da52b7f0fef379fd9b69d68f779d1740429ffe9de81480a9578d')throw Error('baseline gate')
 s=s.replace(/\b827\b/g,'829')
  .replaceAll('015fe5b139b92827ced93aa3f944d8b44681551f','49ee9c3166118b8728c33e95f659961f7916b831')
  .replaceAll('issue-829-coban-identification-015fe5b','issue-829-vehicle-heading-49ee9c3')
  .replaceAll('coban-identification-015fe5b.tar.gz','vehicle-heading-49ee9c3.tar.gz')
  .replace(/^OLD_ROOT = .*$/m,"OLD_ROOT = Path('/var/www/fom-web/releases/issue-827-coban-identification-015fe5b')")
  .replaceAll('6526d4278770fe1c3d42bf1d3dad43928f909a510310610f5e0bff9310a14cd3','8d1af47105b359540a26cc166b4ce6ad2f0c76ab935361fe4a12055a88f6e0ba')
  .replaceAll('a3e27bf57f3d58c92cc25656e7f7f1d1bc3d53c08fb1aba63a6f88981a527833','52d3c26eb8cf9d4790764fd94bb0cc23aec6592e7976e34c12d4ffc33df8e539')
  .replaceAll('569cba2b298342de8f959049a1ba402db7641c2a','33264fa17e63b2b11d04c1413ca37d10d172d71d')
 return s
}
module.exports={generate}
if(require.main===module){const s=generate(fs.readFileSync(process.argv[2],'utf8'));fs.writeFileSync(process.argv[3],s,{flag:'wx'});console.log(sha(s))}
