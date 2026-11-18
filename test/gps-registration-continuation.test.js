import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ofrecerVehiculoTrasGps } from '../src/panel/datos/continuarRegistroGps.js'

test('sin registro confirmado no pregunta ni inicia un alta de vehículo', async () => {
  const inesperado = () => assert.fail('No debe iniciar ninguna acción')
  assert.equal(await ofrecerVehiculoTrasGps(null, { confirmar: inesperado, navegar: inesperado, raiz: '/gps' }), false)
})

test('más tarde conserva el inventario sin iniciar creación ni instalación', async () => {
  assert.equal(await ofrecerVehiculoTrasGps('gps-confirmado', {
    confirmar: async p => { assert.equal(p.cancelar, 'Más tarde'); return false },
    navegar: () => assert.fail('No debe abandonar el GPS registrado'), raiz: '/gps',
  }), false)
})

test('aceptar lleva únicamente el ID confirmado al formulario de instalación, sin crear datos', async () => {
  let destino
  assert.equal(await ofrecerVehiculoTrasGps('gps-confirmado', {
    confirmar: async () => true, raiz: '/gps', navegar: (...args) => { destino = args },
  }), true)
  assert.deepEqual(destino, ['/gps/gps-confirmado/instalar', { state: { crearVehiculoTrasRegistro: true } }])
})
