'use strict'
const fs=require('node:fs'),crypto=require('node:crypto')
const {generate:previous}=require('./issue-822-publication.cjs')
const sha=s=>crypto.createHash('sha256').update(s).digest('hex')
function generate(template){
 let s=previous(template)
 if(sha(s)!=='bc2769409d7e2ffa7c7c2a55cd298c363ffd738a2c03d95d5f3eed67a6cb8d34')throw Error('baseline gate')
 s=s.replace(/\b822\b/g,'824')
  .replaceAll('issue-824-publish-','issue-822-publish-')
  .replaceAll("value.get('issue') == 824","value.get('issue') == 822")
  .replaceAll('(824 if reference == app_run else 824)','(822 if reference == app_run else 824)')
  .replaceAll('124365ed1c147887e98f1fd7bf8ce22a598ae9bc','ed824e70bb70c9c42fb77bc39f011256d3eddb78')
  .replaceAll('issue-824-optional-iccid-124365e','issue-824-gps-receiver-ed824e7')
  .replaceAll('optional-iccid-124365e.tar.gz','gps-receiver-ed824e7.tar.gz')
  .replaceAll("OLD_ROOT = Path('/var/www/fom-web/releases/issue-821-stop-numbers-dcc1f36')","OLD_ROOT = Path('/var/www/fom-web/releases/issue-822-optional-iccid-124365e')")
  .replaceAll('0f030700b582d453576eb7e70d9f4c85148a3e23fb4d9f4aacda9f79a18e4b9b','2048c4a3de99c396fbd8ed8f1dd17c06a6ced657df6f88ded4145185e60eccac')
  .replaceAll('52e966596866aa4cc2a4cee70cc078cd623a13095d9132758b5061840fa0a970','be93339ce50e89657c20a7987f7b40954d1e52d06faf50a7e193458a3c1948a0')
  .replaceAll("'mapboxConfigured':True,'publicConfigSha256'","'mapboxConfigured':True,'gpsReceiverConfigured':True,'publicConfigSha256'")
  .replaceAll('fbf73e247db8911a65e6c55f228c4b37d3554a9dfb8b133369810cf6c70be69b','b1470891795093611bbca035faf86d5c84bb8e14ccc606e87b4c98d29a931ee8')
 return s
}
module.exports={generate}
if(require.main===module){const s=generate(fs.readFileSync(process.argv[2],'utf8'));fs.writeFileSync(process.argv[3],s,{flag:'wx'});console.log(sha(s))}
