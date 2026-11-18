'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');const {generate:previous}=require('./issue-838-publication.cjs');const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function generate(template){let s=previous(template);if(sha(s)!=='290b9807866a5268d67bbe13913d699f85e17367e098caa015365adafff3e408')throw Error('baseline_gate');
return s.replace(/\b838\b/g,'839')
.replaceAll('f1e34f4724cf4bd682d60cd6a6c40e39881e5ca2','b4f54e0cb183cd4389204f11c32e6dff78c6e6f7')
.replaceAll('issue-839-gps-wizard-f1e34f4','issue-839-unassign-b4f54e0')
.replaceAll('gps-wizard-f1e34f4.tar.gz','unassign-b4f54e0.tar.gz')
.replace(/^OLD_ROOT = .*$/m,"OLD_ROOT = Path('/var/www/fom-web/releases/issue-838-gps-wizard-f1e34f4')")
.replaceAll('04aed3234ca25c4f03d4553e8a11a49f809a19efb070604bb0770f81b387d2cd','8bdcd06e7fe1306ed4bf2a65fabe28ba6e276f0918ac2c3bd021b7df754d1f0d')
.replaceAll('0074da1c2df0e3d1ead35830941c8addcd03115a438269b06c97403f633fd07e','7d6813961f0baa63949939a422030c478c29988e33d6b9ec09026da9b57f7ab0');
}module.exports={generate};if(require.main===module){const s=generate(fs.readFileSync(process.argv[2],'utf8'));fs.writeFileSync(process.argv[3],s,{flag:'wx'});console.log(sha(s));}
