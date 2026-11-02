import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerInventory, sha256 } from '../src/panel/meitrack/registration.js'
import { parseSetupReadiness, setupConnectionSms, setupRecoverySms, configuredT399Readback } from '../src/panel/meitrack/meitrack-setup.js'
import { parseT399ClosedReadback } from '../src/panel/meitrack/meitrack-readback.js'
import { parseT399CommandList, t399ReadOnlyQuery } from '../src/panel/meitrack/commands.js'

const imei='999727000000001',firmware='T399L-V254',id='00000000-0000-4000-8000-000000000727'
const payload={imei,manufacturer:'Meitrack',model:'T399L',protocolFamily:'meitrack-t399',firmwareVersion:firmware,transport:'tcp',apn:'synthetic.apn'}
const witness=state=>({registration:{state,id:state==='matching'?id:null,activationAllowed:false}})
function storage(){const values=new Map();return{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),values}}

test('uncertain registration is recovered by reads after reload, with no second POST or sensitive draft',async()=>{
  const saved=storage(),calls=[];let committed=false
  const request=async path=>{calls.push(path);if(path==='register'){committed=true;throw Error('connection lost after commit')}return witness(committed?'matching':'absent')}
  const deps={request,storage:saved,digest:sha256}
  assert.equal(await registerInventory(payload,deps),id)
  assert.equal(await registerInventory(payload,deps),id)
  assert.equal(calls.filter(path=>path==='register').length,1)
  assert.doesNotMatch(JSON.stringify([...saved.values]),/999727|synthetic\.apn|Meitrack|password|DB4/)
})
test('absent witness after uncertain POST never authorizes another write; storage failure blocks before write',async()=>{
  const saved=storage();let writes=0
  const request=async path=>{if(path==='register'){writes++;throw Error('unknown')}return witness('absent')}
  for(let i=0;i<2;i++)await assert.rejects(registerInventory(payload,{request,storage:saved,digest:sha256}),/pendiente/)
  assert.equal(writes,1)
  await assert.rejects(registerInventory(payload,{request,storage:{getItem:()=>null,setItem(){throw Error('storage unavailable')}},digest:sha256}),/storage unavailable/)
  assert.equal(writes,1)
  await assert.rejects(registerInventory({...payload,apn:'changed.apn'},{request,storage:saved,digest:sha256}),/otros datos/)
})
test('invalid or conflicting witness fails closed without creation',async()=>{
  for(const result of [witness('conflict'),witness('unavailable'),{registration:{state:'matching',id,activationAllowed:true}},{}]){
    let writes=0
    await assert.rejects(registerInventory(payload,{storage:storage(),digest:sha256,request:async path=>{if(path==='register')writes++;return result}}))
    assert.equal(writes,0)
  }
})
test('Meitrack SMS requires observed support, recoverable baseline and fresh TEST window; all DB4 fields participate',()=>{
  const baseline=parseT399ClosedReadback(`${imei},DB4,CLOSE,IP1:192.0.2.1,PORT1:10003,IP2:,PORT2:,0,,0,60,0,6,6,0,0,0,0,115,`,imei,firmware)
  assert.ok(baseline)
  assert.equal(t399ReadOnlyQuery('1234','DB4',[]),null)
  assert.deepEqual(parseT399CommandList('A21,DB4,DA6'),['A21','DB4','DA6'])
  assert.equal(parseT399CommandList(`${imei},E04,A21`),null)
  assert.equal(setupRecoverySms('1234',baseline,imei,firmware,true),'1234,A21,0,192.0.2.1,10003,,,')
  const setup=parseSetupReadiness({setup:{ready:true,reason:null,serverNow:'2026-11-02T12:00:00.000Z',activationAllowed:false,window:{reference:'issue/727/synthetic',expiresAt:'2026-11-02T12:10:00.000Z',firmware,destination:{host:'51.81.195.12',port:5002,transport:'tcp'},remainingConnections:99,acknowledgementAllowed:false}}})
  const command=(saved,elapsed)=>setupConnectionSms('1234',baseline,imei,firmware,'synthetic.apn',true,saved,['A21','DB4'],setup,elapsed)
  assert.equal(command(false,0),null);assert.equal(command(true,10000),null)
  assert.equal(command(true,0),'1234,A21,1,51.81.195.12,5002,synthetic.apn,,')
  const cells=[...baseline.cells];cells[2]='TCP';cells[3]='IP1:51.81.195.12';cells[4]='PORT1:5002';cells[8]='synthetic.apn'
  assert.equal(configuredT399Readback(cells.join(','),baseline,imei,firmware,'synthetic.apn',setup.window.destination),true)
  cells[18]='114';assert.equal(configuredT399Readback(cells.join(','),baseline,imei,firmware,'synthetic.apn',setup.window.destination),false)
})
