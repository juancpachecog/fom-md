'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');const {generate:previous}=require('./issue-841-publication.cjs');const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function generate(template){let s=previous(template);if(sha(s)!=='ca7dd6411225bf6c7cd2a4bdf1b81db04cdfdcbaa76ee78fb19925fb23b78b6a')throw Error('baseline_gate');
return s.replace(/\b841\b/g,'842')
.replaceAll('1f795a95b65c4ef3637ed13add8e79d00ab5c15c','bca64cc6b41ae8066bb8c3c748a98f7bbdef4bf6')
.replaceAll('issue-842-discovery-1f795a9','issue-842-gps-vehicle-bca64cc')
.replaceAll('discovery-1f795a9.tar.gz','gps-vehicle-bca64cc.tar.gz')
.replace(/^OLD_ROOT = .*$/m,"OLD_ROOT = Path('/var/www/fom-web/releases/issue-841-discovery-1f795a9')")
.replaceAll('a858f636c7d8b4c8cb0aced1190ffc7e833be4b78d161f00d0925f19a57829ba','6e13469ba33b51438829086fee2d0c5e5cee1048584420b98e0eb2529ba6a991')
.replaceAll('5a48f4242d21b414fcb3286a2e0952a2404f528a4eed89434c03de03e9b96952','f43b2d2512a2312c66650d71158b017760f6380a1c5c71cdddf3626898e1815f');
}module.exports={generate};if(require.main===module){const s=generate(fs.readFileSync(process.argv[2],'utf8'));fs.writeFileSync(process.argv[3],s,{flag:'wx'});console.log(sha(s));}
