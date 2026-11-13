import {test} from 'node:test'
import assert from 'node:assert/strict'
import {cobanIdentificationSms,receivedCobanCandidate} from '../src/panel/datos/coban-identification.js'
test('pausa sólo cambia modo SMS y el retorno conserva TCP o UDP; clave explícita de seis dígitos',()=>{
 assert.deepEqual(cobanIdentificationSms('654321','tcp'),{pause:'SMS654321',resume:'GPRS654321,0,0'})
 assert.deepEqual(cobanIdentificationSms('654321','udp'),{pause:'SMS654321',resume:'GPRS654321,1,1'})
 for(const p of ['','1234','654321\nstop','abcdef'])assert.equal(cobanIdentificationSms(p,'tcp'),null)
 assert.equal(cobanIdentificationSms('654321','other'),null)
})
test('identidad recibida sólo admite campo Coban reciente, no números sueltos, otro IMEI o transporte',()=>{
 const now=Date.parse('2026-11-13T12:00:00Z'),imei='999827000000001'
 const d={imei,origenIdentidad:'coban_imei_field',protocolo:'coban-gps103',ultimaIdentidad:new Date(now-1000).toISOString(),transporte:'tcp',reportando:true}
 const opts={knownImei:imei,transport:'tcp',now}
 assert.equal(receivedCobanCandidate(d,opts),true)
 assert.equal(receivedCobanCandidate(d,{...opts,knownImei:''}),true)
 for(const extra of [{origenIdentidad:'unverified_digits'},{protocolo:'meitrack-t399'},{ultimaIdentidad:null},{ultimaIdentidad:new Date(now-300000).toISOString()},{ultimaIdentidad:new Date(now+5000).toISOString()},{transporte:'udp'},{imei:'999827000000002'},{reportando:false}])assert.equal(receivedCobanCandidate({...d,...extra},opts),false)
})
