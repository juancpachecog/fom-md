import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buscarEquipoGps, empresaDeInstalacion, empresaPropia, mensajeInstalarGps } from '../src/panel/datos/instalarGps.js'

// T-208 · «Instalar en una unidad» no debe dar «no existe» para un equipo que está en el inventario.

const ID = '11111111-1111-4111-8111-111111111111'
const OTRO = '22222222-2222-4222-8222-222222222222'
const error = (estado) => Object.assign(new Error('x'), { estado })

test('el detalle manda: si responde, no se toca la lista', async () => {
  let listas = 0
  const d = await buscarEquipoGps(ID, {
    detalle: async () => ({ device: { id: ID, imei: '1' } }),
    lista: async () => { listas += 1; return { devices: [] } },
  })
  assert.equal(d.imei, '1')
  assert.equal(listas, 0)
})

test('detalle con 404 pero el equipo está en la lista: se usa el de la lista', async () => {
  const d = await buscarEquipoGps(ID, {
    detalle: async () => { throw error(404) },
    lista: async () => ({ devices: [{ id: OTRO, imei: '2' }, { id: ID, imei: '1' }] }),
  })
  assert.equal(d.id, ID)
  assert.equal(d.imei, '1')
})

test('detalle con 404 y fuera de la lista: null (no está en el inventario)', async () => {
  const d = await buscarEquipoGps(ID, {
    detalle: async () => { throw error(404) },
    lista: async () => ({ devices: [{ id: OTRO }] }),
  })
  assert.equal(d, null)
  const vacio = await buscarEquipoGps(ID, { detalle: async () => { throw error(404) }, lista: async () => ({}) })
  assert.equal(vacio, null)
})

test('otros errores del detalle se propagan sin ir a la lista', async () => {
  let listas = 0
  await assert.rejects(
    buscarEquipoGps(ID, { detalle: async () => { throw error(403) }, lista: async () => { listas += 1; return { devices: [] } } }),
    (e) => e.estado === 403,
  )
  assert.equal(listas, 0)
})

test('empresa propia: la de la cuenta aunque se esté dentro de otra', () => {
  assert.equal(empresaPropia({ perfil: { empresaId: 'X' }, perfilGlobal: { empresaId: 'FOM' } }), 'FOM')
  assert.equal(empresaPropia({ perfil: { empresaId: 'FOM' } }), 'FOM')
  assert.equal(empresaPropia(null), null)
})

test('ruta de la instalación: la propia es null; otra empresa, la suya', () => {
  assert.equal(empresaDeInstalacion('FOM', 'FOM'), null)
  assert.equal(empresaDeInstalacion('', 'FOM'), null)
  assert.equal(empresaDeInstalacion('X', null), 'X')
  assert.equal(empresaDeInstalacion('X', 'FOM'), 'X')
})

test('mensajes de la instalación en llano', () => {
  assert.match(mensajeInstalarGps(error(409)), /ya lleva un GPS/u)
  const otra = mensajeInstalarGps(error(404), { otraEmpresa: true, nombrePropia: 'FOM Operations' })
  assert.match(otra, /inventario de FOM Operations/u)
  assert.match(mensajeInstalarGps(error(404)), /no encontró el equipo o la unidad/u)
  assert.equal(mensajeInstalarGps(new Error('Algo raro')), 'Algo raro')
})
