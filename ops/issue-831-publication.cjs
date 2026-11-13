'use strict'
const fs=require('node:fs'),crypto=require('node:crypto')
const {generate:previous}=require('./issue-829-publication.cjs')
const sha=s=>crypto.createHash('sha256').update(s).digest('hex')
// WEB-only change; the published API829 receipt remains the baseline.
function generate(template){
 let s=previous(template)
 if(sha(s)!=='7df4dcef1327eea6919ea0dcc15ce384b341fd48b22cf7f1fa0a0135e00a71d3')throw Error('baseline gate')
 s=s.replace(/\b829\b/g,'831')
  .replaceAll('49ee9c3166118b8728c33e95f659961f7916b831','8de03d9d75674ebf2b19b039de2b7005daa43f6c')
  .replaceAll('issue-831-vehicle-heading-49ee9c3','issue-831-gps-test-8de03d9')
  .replaceAll('vehicle-heading-49ee9c3.tar.gz','gps-test-8de03d9.tar.gz')
  .replace(/^OLD_ROOT = .*$/m,"OLD_ROOT = Path('/var/www/fom-web/releases/issue-829-vehicle-heading-49ee9c3')")
  .replaceAll('8d1af47105b359540a26cc166b4ce6ad2f0c76ab935361fe4a12055a88f6e0ba','c200a4fa757a20a059637d9e5381ad78e2030dbd3f9283ec2f411990e92870c8')
  .replaceAll('52d3c26eb8cf9d4790764fd94bb0cc23aec6592e7976e34c12d4ffc33df8e539','ed48da4acd695224aad30ab9d4ca1bdb5fa69b8faff4e5882684b7e55c9c233e')
  .replaceAll('issue-831-publish-','issue-829-publish-')
  .replace("value.get('issue') == 831 and value.get('result') == 'PASS'","value.get('issue') == 829 and value.get('result') == 'PASS'")
  .replace("value['issue'] == (831 if reference == app_run else 831)","value['issue'] == (829 if reference == app_run else 831)")
 return s
}
module.exports={generate}
if(require.main===module){const s=generate(fs.readFileSync(process.argv[2],'utf8'));fs.writeFileSync(process.argv[3],s,{flag:'wx'});console.log(sha(s))}
