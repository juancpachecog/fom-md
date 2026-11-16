'use strict'
const fs=require('node:fs'),crypto=require('node:crypto')
const {generate:previous}=require('./issue-824-publication.cjs')
const sha=s=>crypto.createHash('sha256').update(s).digest('hex')
function generate(template){
 let s=previous(template)
 if(sha(s)!=='a7432adce3efa43183b1cdf461187adbf5b43166a23f3295dc5443b145e214fc')throw Error('baseline gate')
 s=s.replace(/\b824\b/g,'825').replace(/\b822\b/g,'825')
  .replaceAll('ed824e70bb70c9c42fb77bc39f011256d3eddb78','5c699e028cbac8ccafe0e8479ef02fe5ec92c8a7')
  .replaceAll('issue-825-gps-receiver-ed824e7','issue-825-gps-inventory-5c699e0')
  .replaceAll('gps-receiver-ed824e7.tar.gz','gps-inventory-5c699e0.tar.gz')
  .replace(/^OLD_ROOT = .*$/m,"OLD_ROOT = Path('/var/www/fom-web/releases/issue-824-gps-receiver-ed824e7')")
  .replaceAll('2048c4a3de99c396fbd8ed8f1dd17c06a6ced657df6f88ded4145185e60eccac','04785ceb27a6af4a4bbde02deb955738a216cecdb371bc7f99d663733b66aeab')
  .replaceAll('be93339ce50e89657c20a7987f7b40954d1e52d06faf50a7e193458a3c1948a0','4dcd30b7d4f19e67f3b7e9d39d9f0d788363376694362a109fd4202692311ecc')
  .replaceAll('9b5e2e3d73dc9c6a6c7214bff1bdf2b31a29f0c2','619cada70e0cafbe493fd26611610819ffe571a0')
  .replaceAll("'gpsReceiverConfigured':True,'publicConfigSha256'","'gpsReceiverConfigured':True,'gpsFlowVerified':True,'publicConfigSha256'")
 return s
}
module.exports={generate}
if(require.main===module){const s=generate(fs.readFileSync(process.argv[2],'utf8'));fs.writeFileSync(process.argv[3],s,{flag:'wx'});console.log(sha(s))}
