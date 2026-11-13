'use strict'
const fs=require('node:fs'),crypto=require('node:crypto')
const {generate: previous}=require('./issue-821-publication.cjs')
const sha=s=>crypto.createHash('sha256').update(s).digest('hex')
function generate(template){
 let s=previous(template)
 if(sha(s)!=='f67937851de1ea7a625cd0b9fbe9cf9628bf43e07e4044156b4c388da9e1494a')throw Error('baseline gate')
 return s.replace(/\b821\b/g,'822')
  .replaceAll('dcc1f3614e268ceebeece36a94f461778aecad25','124365ed1c147887e98f1fd7bf8ce22a598ae9bc')
  .replaceAll('issue-822-stop-numbers-dcc1f36','issue-822-optional-iccid-124365e')
  .replaceAll('stop-numbers-dcc1f36.tar.gz','optional-iccid-124365e.tar.gz')
  .replaceAll("OLD_ROOT = Path('/var/www/fom-web/releases/issue-820-route-direction-4a8809c')","OLD_ROOT = Path('/var/www/fom-web/releases/issue-821-stop-numbers-dcc1f36')")
  .replaceAll('68b48169d9f2f521a4baa15fb52d5bccda765ce8eccd872b87c5a613d8a66cd8','0f030700b582d453576eb7e70d9f4c85148a3e23fb4d9f4aacda9f79a18e4b9b')
  .replaceAll('88cefec74682584ec9e863a2f3cf69691422bdb36a017094850e1cbf39e557b8','52e966596866aa4cc2a4cee70cc078cd623a13095d9132758b5061840fa0a970')
  .replace(/\b817\b/g,'822')
  .replaceAll('849979876222569e4a4d19a9c0d7e624464fbe32','9b5e2e3d73dc9c6a6c7214bff1bdf2b31a29f0c2')
}
module.exports={generate}
if(require.main===module){const s=generate(fs.readFileSync(process.argv[2],'utf8'));fs.writeFileSync(process.argv[3],s,{flag:'wx'});console.log(sha(s))}
