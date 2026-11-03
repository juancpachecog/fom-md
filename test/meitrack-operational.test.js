import {test} from 'node:test'
import assert from 'node:assert/strict'
import {receiverAvailable,connectionSms,connectionReadback} from '../src/panel/meitrack/operational-setup.js'
const receiver={available:true,reference:'meitrack-operational-00000000-0000-4000-8000-000000000727',destination:{host:'51.81.195.12',port:5002,transport:'tcp'},activationAllowed:false}
test('permanent receiver requires exact Meitrack endpoint, running instance and no activation',()=>{
 assert.deepEqual(receiverAvailable({receiver}),receiver)
 for(const patch of [{available:false},{reference:'issue/727/expired-trial'},{destination:{...receiver.destination,port:5001}},{activationAllowed:true}])assert.equal(receiverAvailable({receiver:{...receiver,...patch}}),null)
})
test('A21 configures APN and endpoint without baseline or recovery; pending/credentials/receiver still block',()=>{
 const args=['1234','internet.movistar.ve',receiver,true,{closed:true,gprs:0,sms:0},true]
 assert.equal(connectionSms(...args),'1234,A21,1,51.81.195.12,5002,internet.movistar.ve,,')
 for(const [i,v] of [[0,'bad'],[1,'apn,password'],[2,null],[3,false],[4,{gprs:1,sms:0}],[5,false]]){const changed=[...args];changed[i]=v;assert.equal(connectionSms(...changed),null)}
})
test('DB4 checks same identity, qualified firmware, TCP, APN and FOM destination without retaining old config',()=>{
 const imei='999727000000001',raw=`${imei},DB4,TCP,IP1:51.81.195.12,PORT1:5002,IP2:,PORT2:,0,internet.movistar.ve,0,60,0,6,6,0,0,0,0,115,`
 assert.equal(connectionReadback(raw,imei,'T399L-V254','internet.movistar.ve'),true)
 for(const changed of [raw.replace('5002','5001'),raw.replace('TCP','UDP'),raw.replace(imei,'999727000000002'),raw.replace('internet.movistar.ve','other.apn')])assert.equal(connectionReadback(changed,imei,'T399L-V254','internet.movistar.ve'),false)
})
