import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readIdentitySms, readCommandsSms, readPendingSms, readConnectionOk } from '../src/panel/meitrack/guided-sms.js'
import { parseT399ClosedReadback } from '../src/panel/meitrack/meitrack-readback.js'
import { setupRecoverySms } from '../src/panel/meitrack/meitrack-setup.js'

const imei = '999727000000001', other = '999727000000002'
test('E91 identifica IMEI y versión sin pedirlos antes; número de serie no sale del parser', () => {
  assert.deepEqual(readIdentitySms(`${imei},E91,T399L-V254,SYNTHETIC727`), { imei, firmware: 'T399L-V254', supported: true })
  assert.equal(readIdentitySms(`${imei},E91,T399L-V255,SYNTHETIC727`).supported, false)
  for (const raw of [`${imei},E91,T399L-V254`, `${imei},E91,T399L-V254,SN,EXTRA`, `${imei},E91,T399L-V254,SN\nSECRET`, '1234,E91']) assert.equal(readIdentitySms(raw), null)
  assert.equal(readIdentitySms(`${imei},E91,T399L-V254,SN`, other), null)
  assert.equal(readIdentitySms(`${imei},E91,T399L-V254,SN`, imei).supported, true)
})
test('la respuesta E04 completa queda ligada al mismo equipo y al conjunto necesario', () => {
  assert.deepEqual(readCommandsSms(`${imei},E04,DB4,DA6,A21,B36,C03,AFF,DDD`, imei), ['DB4', 'DA6', 'A21', 'B36', 'C03', 'AFF', 'DDD'])
  assert.deepEqual(readCommandsSms('A21,DB4,DA6', imei), ['A21', 'DB4', 'DA6'])
  for (const raw of [`${other},E04,A21,DB4,DA6`, `${imei},E04,A21,DB4`, `${imei},E04,A21,DB4,DA6,0000,password`]) assert.equal(readCommandsSms(raw, imei), null)
  assert.equal(readCommandsSms(`${imei},E04,A21,DB4,DA6`, ''), null)
})
test('DA6 conserva pendientes y estado sin convertir satélites o contadores en certificación', () => {
  const raw = `${imei},DA6,Disconnect:CLOSE,IP1:192.0.2.1,PORT1:10003,GPRS_INT:6,CSQ:14,GPS_SUM:8,GPRS/SMS:0/0,IO:0000,BAT/DCIN:4310/13810`
  assert.deepEqual(readPendingSms(raw, imei), { closed: true, gprs: 0, sms: 0 })
  assert.deepEqual(readPendingSms(raw.replace('0/0', '12/3'), imei), { closed: true, gprs: 12, sms: 3 })
  assert.deepEqual(readPendingSms(raw.replace('CLOSE', 'TCP'), imei), { closed: false, gprs: 0, sms: 0 })
  assert.equal(readPendingSms(raw, other), null)
  assert.equal(readPendingSms(raw, ''), null)
  assert.equal(readPendingSms(raw + ',GPRS/SMS:0/0', imei), null)
})
test('OK sólo es reconocido en A21 del equipo; la recuperación sigue saliendo del baseline completo', () => {
  assert.equal(readConnectionOk(`${imei},A21,OK`, imei), true)
  for (const raw of ['OK', 'A21,OK', `${other},A21,OK`, `${imei},A21,ERROR`, `${imei},DB4,OK`]) assert.equal(readConnectionOk(raw, imei), false)
  assert.equal(readConnectionOk(`${imei},A21,OK`, ''), false)
  const b = parseT399ClosedReadback(`${imei},DB4,CLOSE,IP1:192.0.2.1,PORT1:10003,IP2:,PORT2:,0,,0,60,0,6,6,0,0,0,0,115,`, imei, 'T399L-V254')
  assert.equal(setupRecoverySms('1234', b, imei, 'T399L-V254', true), '1234,A21,0,192.0.2.1,10003,,,')
})
