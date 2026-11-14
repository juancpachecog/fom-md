import test from 'node:test'
import assert from 'node:assert/strict'
import { cambiarCompanias, relacionesDeContratista } from '../src/panel/datos/companiasEmpresa.js'

test('agrega en dirección compañía–contratista y termina la asociación quitada sin repetir las vigentes', async () => {
  const companias = ['a', 'b', 'c'].map(id => ({ id }))
  const activos = new Map([['a', [{ id: 'ra', contractorTenantId: 'contratista', active: true }]], ['b', [{ id: 'rb', contractorTenantId: 'contratista', active: true }]], ['c', []]])
  const acciones = []
  await cambiarCompanias('contratista', ['b', 'c'], companias, {
    listar: async id => activos.get(id),
    terminar: async id => { acciones.push(['terminar', id]); activos.set('a', []) },
    vincular: async (compania, contratista) => { acciones.push(['vincular', compania, contratista]); activos.set(compania, [{ id: 'rc', contractorTenantId: contratista, active: true }]) },
  })
  assert.deepEqual(acciones, [['terminar', 'ra'], ['vincular', 'c', 'contratista']])
})
test('historial inactivo y relaciones de otra contratista no se atribuyen al formulario', async () => {
  const result = await relacionesDeContratista('propia', [{ id: 'a' }], async () => [
    { id: 'vieja', contractorTenantId: 'propia', active: false }, { id: 'ajena', contractorTenantId: 'otra', active: true },
  ])
  assert.deepEqual(result, [])
})
test('si se pierde la respuesta, lee el estado real y no repite automáticamente la mutación', async () => {
  let escrituras = 0, lecturas = 0
  await assert.rejects(cambiarCompanias('propia', ['a'], [{ id: 'a' }], {
    listar: async () => { lecturas++; return [] },
    vincular: async () => { escrituras++; throw new Error('red') }, terminar: async () => assert.fail(),
  }), /No quedó verificado/)
  assert.equal(escrituras, 1); assert.equal(lecturas, 2)
})
