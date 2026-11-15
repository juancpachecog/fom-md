'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const {generate:previous}=require('./issue-835-publication.cjs');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function generate(template){
 let s=previous(template);
 if(sha(s)!=='c551e3f2b6dc874074967e775b5647fa47d8da7bcc7d7f393684847123aae848')throw Error('baseline_gate');
 s=s.replace(/\b835\b/g,'838')
 .replaceAll('27cf0ba827d5b1c8b6268f253901be7bdad5b3eb','f1e34f4724cf4bd682d60cd6a6c40e39881e5ca2')
 .replaceAll('ebe6bb7a55780efa5ee604618bac07a245af724a','0d6513ea59558c2eb5518079aac28c94f4079a5c')
 .replaceAll('issue-838-admin-30s-27cf0ba','issue-838-gps-wizard-f1e34f4')
 .replaceAll('admin-30s-27cf0ba.tar.gz','gps-wizard-f1e34f4.tar.gz')
 .replace(/^OLD_ROOT = .*$/m,"OLD_ROOT = Path('/var/www/fom-web/releases/issue-835-admin-30s-27cf0ba')")
 .replaceAll('dee485d977c110cd11a8223e7cbe231f353043f88941c0382559eeb5be7a4697','04aed3234ca25c4f03d4553e8a11a49f809a19efb070604bb0770f81b387d2cd')
 .replaceAll('3dadf35b4cd1422f021005cf4f526c001e6cab753213253e7b823077f5eac46b','0074da1c2df0e3d1ead35830941c8addcd03115a438269b06c97403f633fd07e')
 .replace("value.get('issue') == 838 and value.get('result') == 'PASS'","value.get('issue') == 834 and value.get('result') == 'PASS'")
 .replaceAll("r'issue-838-publish-","r'issue-834-publish-")
 .replace("value['issue'] == (838 if reference == app_run else 838)","value['issue'] == (834 if reference == app_run else 838)");
 return s;
}
module.exports={generate};
if(require.main===module){const s=generate(fs.readFileSync(process.argv[2],'utf8'));fs.writeFileSync(process.argv[3],s,{flag:'wx'});console.log(sha(s));}
