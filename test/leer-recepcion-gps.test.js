import test from 'node:test'
import assert from 'node:assert/strict'
import { leerRecepcionGps } from '../src/panel/datos/leerRecepcionGps.js'

test('falla de transporte, sesión o contrato no equivale a inventario vacío', async () => {
  for (const fallo of [new Error('private error'), { estado: 500 }, { estado: 401 }]) {
    await assert.rejects(leerRecepcionGps(() => Promise.reject(fallo)), error => {
      assert.match(error.message, /No se pudo comprobar la recepción/)
      assert.doesNotMatch(error.message, /private error/)
      assert.equal(error.estado, fallo.estado)
      return true
    })
  }
  for (const respuesta of [null, {}, { devices: null }])
    await assert.rejects(leerRecepcionGps(async () => respuesta), /No se pudo comprobar la recepción/)
  assert.deepEqual(await leerRecepcionGps(async () => ({ devices: [] })), [])
})

test('403 opcional conserva permisos; administración global debe mostrar el fallo', async () => {
  const leer = () => Promise.reject({ estado: 403 })
  assert.deepEqual(await leerRecepcionGps(leer), [])
  await assert.rejects(leerRecepcionGps(leer, { opcional: false }), /No se pudo comprobar/)
})
