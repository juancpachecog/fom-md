import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validarPreparacion, identidadConfirmada, coincideDetectado, testigoInventarioCoban } from '../src/panel/datos/gps-discovery.js'
import { registerInventory, sha256 } from '../src/panel/meitrack/registration.js'
import { t399ReadOnlyQuery } from '../src/panel/meitrack/commands.js'

const imei = '999727000000001', other = '999727000000002', now = Date.parse('2026-11-02T17:00:00Z')
test('preparar sin IMEI permite los dos modelos; un IMEI conocido inválido no se omite', () => {
  for (const [marca, modelo] of [['Coban', 'GPS-403'], ['Meitrack', 'T399L']]) {
    assert.deepEqual(validarPreparacion({ marca, modelo, imei: '' }), {})
    assert.ok(validarPreparacion({ marca, modelo, imei: '123' }).imei)
  }
  assert.equal(t399ReadOnlyQuery('1234', 'E91', []), '1234,E91')
  assert.equal(t399ReadOnlyQuery('1234', 'E04', []), '1234,E04')
})
test('el SMS fija la identidad final; la señal sola no sustituye la consulta ni un IMEI conocido diferente', () => {
  const d = { imei, transporte: 'tcp', reportando: true, ultimaVez: new Date(now - 1000).toISOString() }
  const options = { inicial: '', sms: imei, transporte: 'tcp', ahora: now }
  assert.equal(coincideDetectado(d, options), true)
  for (const patch of [{ sms: '' }, { sms: '123' }, { sms: other }, { inicial: other }, { transporte: 'udp' }]) {
    assert.equal(coincideDetectado(d, { ...options, ...patch }), false)
  }
  assert.equal(identidadConfirmada('', imei), imei)
  assert.equal(identidadConfirmada(imei, other), null)
  for (const patch of [{ reportando: false }, { ultimaVez: new Date(now - 300000).toISOString() }, { ultimaVez: new Date(now + 10000).toISOString() }, { ultimaVez: null }]) {
    assert.equal(coincideDetectado({ ...d, ...patch }, options), false)
  }
})
test('registro final Coban: POST incierto se recupera por lectura independiente, nunca se repite ni adopta otra instalación', async () => {
  const payload = { imei, manufacturer: 'Coban', model: 'GPS-403', protocolFamily: 'coban-gps103', transport: 'tcp', simPhone: 'synthetic-line', apn: 'synthetic.apn' }
  const row = { id: '00000000-0000-4000-8000-000000000727', imei, fabricante: payload.manufacturer, modelo: payload.model,
    protocolo: payload.protocolFamily, transport: 'tcp', simPhone: payload.simPhone, apn: payload.apn, estado: 'inventory' }
  const values = new Map(), storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) }
  let rows = [], writes = 0
  const request = async path => {
    if (path === 'registration') return testigoInventarioCoban(rows, payload)
    writes++; rows = [row]; throw Error('lost response after commit')
  }
  for (let i = 0; i < 2; i++) assert.equal(await registerInventory(payload, { request, storage, digest: sha256 }), row.id)
  assert.equal(writes, 1)
  assert.doesNotMatch(JSON.stringify([...values]), /999727|synthetic|Coban|password/)
  for (const patch of [{ protocolo: 'meitrack-t399' }, { fabricante: 'Meitrack' }, { transport: 'udp' }, { estado: 'active' }, { vehiculoId: 'vehicle' }, { instalacionId: 'installation' }, { apn: 'other' }]) {
    assert.equal(testigoInventarioCoban([{ ...row, ...patch }], payload).registration.state, 'conflict')
  }
})
