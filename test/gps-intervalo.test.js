import { test } from 'node:test'
import assert from 'node:assert/strict'
import { comandoIntervalo, INTERVALO_GPS_PREDETERMINADO } from '../src/panel/datos/intervaloGps.js'

test('30 segundos por defecto: A12 usa unidades de diez segundos, sin convertirlos en cinco minutos', () => {
  assert.equal(INTERVALO_GPS_PREDETERMINADO, 30)
  assert.equal(comandoIntervalo({ modelo: 'T399L', clave: '0000', compatible: true }), '0000,A12,3')
  assert.equal(comandoIntervalo({ modelo: 'T399L', clave: '0000', segundos: 120, compatible: true }), '0000,A12,12')
})
test('GPS-403 establece ambos intervalos y no limita el número de posiciones', () => {
  assert.equal(comandoIntervalo({ modelo: 'GPS-403', clave: '111111', compatible: true }), 'Sleep111111 off 030s030s***n')
  assert.equal(comandoIntervalo({ modelo: 'GPS-403', clave: '111111', segundos: 300, compatible: true }), 'Sleep111111 off 300s300s***n')
})
test('no arma comandos con firmware sin comprobar, otra marca, clave inválida o intervalo no representable', () => {
  for (const modelo of ['T399L', 'GPS-403', 'otro']) {
    assert.equal(comandoIntervalo({ modelo, clave: '0000' }), null)
    assert.equal(comandoIntervalo({ modelo, clave: '0000,RESET', compatible: true }), null)
    assert.equal(comandoIntervalo({ modelo, clave: '0000', segundos: 15, compatible: true }), null)
  }
})
