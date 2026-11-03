import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {clockReadbackReceipt} from '../src/panel/meitrack/clock-readback.js'
const imei='999727000000001',fw='T399L-V254',at='2026-01-01T00:00:00Z'
const raw=`${imei},DB4,TCP,IP1:192.0.2.1,PORT1:5002,IP2:,PORT2:,0,internet.example,0,60,0,60,60,0,80,30,0,114,`
test('browser preserves exact private readback hash and only exports neutral metadata for owner review',async()=>{
 const r=await clockReadbackReceipt(raw,imei,fw,at)
 assert.equal(r.readbackSha256,createHash('sha256').update(raw).digest('hex'))
 assert.equal(r.identitySha256,createHash('sha256').update(imei).digest('hex'))
 assert.equal(r.gprsOffsetMinutes,0);assert.equal(r.issuesAttestation,false);assert.equal(r.status,'owner_review_required')
 for(const secret of [imei,'internet.example','192.0.2.1','PORT1'])assert.equal(JSON.stringify(r).includes(secret),false)
})
test('unsupported/wrong unit, missing observation time, non-UTC and OK alone cannot create a readback receipt',async()=>{
 for(const args of [[raw,'999727000000002',fw,at],[raw,imei,'other',at],[raw,imei,fw,''],
 [raw.replace(',0,internet',',240,internet'),imei,fw,at],['B36,OK',imei,fw,at],
 [raw,imei,fw,'2999-01-01T00:00:00Z']])assert.equal(await clockReadbackReceipt(...args),null)
})
