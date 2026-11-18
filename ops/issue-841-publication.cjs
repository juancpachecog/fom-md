'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');const {generate:previous}=require('./issue-839-publication.cjs');const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function generate(template){let s=previous(template);if(sha(s)!=='3c4e3b7218c392e2a1c3dd5b1b890b69975227f11ec953603d78c52e43a2c74d')throw Error('baseline_gate');
return s.replace(/\b839\b/g,'841')
.replaceAll('b4f54e0cb183cd4389204f11c32e6dff78c6e6f7','1f795a95b65c4ef3637ed13add8e79d00ab5c15c')
.replaceAll('issue-841-unassign-b4f54e0','issue-841-discovery-1f795a9')
.replaceAll('unassign-b4f54e0.tar.gz','discovery-1f795a9.tar.gz')
.replace(/^OLD_ROOT = .*$/m,"OLD_ROOT = Path('/var/www/fom-web/releases/issue-839-unassign-b4f54e0')")
.replaceAll('8bdcd06e7fe1306ed4bf2a65fabe28ba6e276f0918ac2c3bd021b7df754d1f0d','a858f636c7d8b4c8cb0aced1190ffc7e833be4b78d161f00d0925f19a57829ba')
.replaceAll('7d6813961f0baa63949939a422030c478c29988e33d6b9ec09026da9b57f7ab0','5a48f4242d21b414fcb3286a2e0952a2404f528a4eed89434c03de03e9b96952');
}module.exports={generate};if(require.main===module){const s=generate(fs.readFileSync(process.argv[2],'utf8'));fs.writeFileSync(process.argv[3],s,{flag:'wx'});console.log(sha(s));}
