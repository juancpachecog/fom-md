'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const {generate:previous}=require('./issue-842-publication.cjs');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function generate(template){
 let s=previous(template);
 if(sha(s)!=='4394b9568462332a866245f33ea6055a42e90af5a9bc6c2b2e8adb11d2080811')throw Error('baseline_gate');
 s=s.replace(/\b842\b/g,'844').replace(/\b834\b/g,'844')
 .replaceAll('bca64cc6b41ae8066bb8c3c748a98f7bbdef4bf6','50baf8b360cc48ff141df8fee048ac96115336a8')
 .replaceAll('0d6513ea59558c2eb5518079aac28c94f4079a5c','f3b91f33ad9465e8f4f7ec5ba7680f1b0d78dc57')
 .replaceAll('issue-844-gps-vehicle-bca64cc','issue-844-gps-functions-50baf8b')
 .replaceAll('gps-vehicle-bca64cc.tar.gz','gps-functions-50baf8b.tar.gz')
 .replace(/^OLD_ROOT = .*$/m,"OLD_ROOT = Path('/var/www/fom-web/releases/issue-842-gps-vehicle-bca64cc')")
 .replaceAll('6e13469ba33b51438829086fee2d0c5e5cee1048584420b98e0eb2529ba6a991','95cd047d63ccbd78c064b31b4889c3731bb37d5af3fced6204c9a58b3fa02309')
 .replaceAll('f43b2d2512a2312c66650d71158b017760f6380a1c5c71cdddf3626898e1815f','e833afeb34affd95cb6570b5685eabe3439ec7f20aa77270566a54e71c475819');
 if(!s.includes("API_HEAD = 'f3b91f33ad9465e8f4f7ec5ba7680f1b0d78dc57'")||/issue-834-publish/.test(s))throw Error('api844_gate');
 return s;
}
module.exports={generate};
if(require.main===module){const s=generate(fs.readFileSync(process.argv[2],'utf8'));fs.writeFileSync(process.argv[3],s,{flag:'wx'});console.log(sha(s));}
