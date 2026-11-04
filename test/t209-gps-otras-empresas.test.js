import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ACCION_OTRAS_EMPRESAS, RUTA_OTRAS_EMPRESAS, TEXTO_OTRAS_EMPRESAS, TITULO_OTRAS_EMPRESAS,
} from '../src/panel/datos/gpsOtrasEmpresas.js'
import { aRutaPorEnte } from '../src/panel/datos/rutaPorEnte.js'

// T-209 · El inventario GPS de la web no puede juntar las empresas (el servidor no tiene la ruta
// con cookie): debe decirlo en llano y llevar a «Entrar a empresa».

test('el aviso dice la regla en español llano y ofrece la salida', () => {
  assert.match(TEXTO_OTRAS_EMPRESAS, /entrando a esa empresa/)
  assert.match(TEXTO_OTRAS_EMPRESAS, /hasta que el servidor permita verlos desde aquí/)
  assert.equal(ACCION_OTRAS_EMPRESAS, 'Buscar en otra empresa')
  assert.ok(TITULO_OTRAS_EMPRESAS.length > 0)
  assert.equal(RUTA_OTRAS_EMPRESAS, '/panel/admin/empresas')
})

test('la pantalla del inventario muestra el aviso con el acceso rápido', () => {
  const fuente = readFileSync(new URL('../src/panel/modulos/AdminGps.jsx', import.meta.url), 'utf8')
  assert.match(fuente, /TEXTO_OTRAS_EMPRESAS/)
  assert.match(fuente, /to=\{RUTA_OTRAS_EMPRESAS\}/)
})

test('el listado de equipos sigue siendo el de la empresa propia, también dentro de otra empresa', () => {
  // Es global: no se reescribe a /tenants/{id}, que el servidor aún no tiene para lectura.
  const ruta = '/api/v1/console/gps-devices'
  assert.equal(aRutaPorEnte(ruta, 'GET', 'e1'), ruta)
})

import { deLaEmpresa, empresasDe, hayListadoGlobal } from '../src/panel/datos/gpsOtrasEmpresas.js'
import { buscarEquipos } from '../src/panel/datos/gps.js'
import { empresaDeInstalacion } from '../src/panel/datos/instalarGps.js'

const equipos = [
  { id: 'a', imei: '861000000000001', empresaId: 'e1', empresaNombre: 'FOM' },
  { id: 'b', imei: '861000000000002', empresaId: 'e2', empresaNombre: 'Transportes Sol' },
  { id: 'c', imei: '861000000000003', empresaId: 'e2', empresaNombre: 'Transportes Sol' },
]

test('junta las empresas de la lista, por nombre y con su cuenta', () => {
  assert.deepEqual(empresasDe(equipos).map((e) => [e.nombre, e.equipos]), [['FOM', 1], ['Transportes Sol', 2]])
})

test('el filtro por empresa acota y vacío deja todas; el total no cambia', () => {
  assert.equal(deLaEmpresa(equipos, 'e2').length, 2)
  assert.equal(deLaEmpresa(equipos, '').length, 3)
})

test('el buscador por IMEI y por empresa encuentra equipos de otras empresas', () => {
  assert.deepEqual(buscarEquipos(equipos, '000000000002').map((g) => g.id), ['b'])
  assert.deepEqual(buscarEquipos(equipos, 'sol').map((g) => g.id), ['b', 'c'])
})

test('sin tenantId (servidor actual) no hay listado global y se muestra el aviso', () => {
  assert.equal(hayListadoGlobal([{ id: 'x', empresaId: null }]), false)
  assert.equal(hayListadoGlobal(equipos), true)
})

test('instalar un equipo de otra empresa va por la ruta de SU empresa; uno propio, por la ruta propia', () => {
  assert.equal(empresaDeInstalacion('e2', 'e1'), 'e2')
  assert.equal(empresaDeInstalacion('e1', 'e1'), null)
})
