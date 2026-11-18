'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const {generate:previous}=require('./issue-844-publication.cjs');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function generate(template){
 let s=previous(template);
 if(sha(s)!=='2101600f6e4316fb9b54d6901b737bc6c9600f50d6e7c93e53bd09c3d68f05e4')throw Error('reviewed844_baseline');
 s=s.replace(/\b844\b/g,'846')
 .replaceAll('50baf8b360cc48ff141df8fee048ac96115336a8','eb299171bf94a7ceaba70b68da09bbd81ac59e13')
 .replaceAll('f3b91f33ad9465e8f4f7ec5ba7680f1b0d78dc57','b76a20c89c45541cd2fd599f4bbdaa77ecd976c1')
 .replaceAll('gps-functions-50baf8b','gps-review-eb29917')
 .replace(/^OLD_ROOT = .*$/m,"OLD_ROOT = Path('/var/www/fom-web/releases/issue-844-gps-functions-50baf8b')")
 .replace(/^OLD_CONFIG = .*$/m,"OLD_CONFIG = 'b87d95395b615fba2b97db84761533aef5083fd86119c506cfcd77d6ad35de92'")
 .replace(/^OLD_INDEX = .*$/m,"OLD_INDEX = '93ceb645eda66a0fd72b42788c1422bf0f8784157292b6be576587c5ec1df7ec'");
 if(!s.includes("API_HEAD = 'b76a20c89c45541cd2fd599f4bbdaa77ecd976c1'")||s.includes('issue-844-publish'))throw Error('api846_gate');
 return s;
}
module.exports={generate};
if(require.main===module){const s=generate(fs.readFileSync(process.argv[2],'utf8'));fs.writeFileSync(process.argv[3],s,{flag:'wx'});console.log(sha(s));}
