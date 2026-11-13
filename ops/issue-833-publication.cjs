'use strict'
const fs=require('node:fs'),crypto=require('node:crypto')
const {generate:previous}=require('./issue-832-publication.cjs')
const sha=s=>crypto.createHash('sha256').update(s).digest('hex')
// WEB-only daily-distance presentation. Preserve the API829 baseline.
function generate(template){
 let s=previous(template)
 if(sha(s)!=='ac4fac44fdab5463bb04962a158faf40a4953e602714768da7a9a3d516e63726')throw Error('baseline gate')
 s=s.replace(/\b832\b/g,'833')
  .replaceAll('98eb5df7e8d8356832cb99093e93ed295b32ad76','238e0c0bb91b8a82828e349d77324e788b98c6ca')
  .replaceAll('issue-833-company-context-98eb5df','issue-833-daily-km-238e0c0')
  .replaceAll('company-context-98eb5df.tar.gz','daily-km-238e0c0.tar.gz')
  .replace(/^OLD_ROOT = .*$/m,"OLD_ROOT = Path('/var/www/fom-web/releases/issue-832-company-context-98eb5df')")
  .replaceAll('eb12d8a227fc85f158795936047560113743ca492fd9b6eb4810fda8b2e13c2d','b9e177c29265c82b79d9097be01c0b17e5353fe93f23957275a940d654406bb1')
  .replaceAll('95dc08617b5519abcc3ed036d6b32022c6f79b34caea15c63fcfba7f5f0b4aa9','10f861ac88bb3d79fbde77eeac6c46d7f89c18fffc2e6fc2b85dcf8210ea630a')
 return s
}
module.exports={generate}
if(require.main===module){const s=generate(fs.readFileSync(process.argv[2],'utf8'));fs.writeFileSync(process.argv[3],s,{flag:'wx'});console.log(sha(s))}
