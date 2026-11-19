import test from 'node:test'
import assert from 'node:assert/strict'
import { reorganizarMenu } from '../src/panel/hardware-navegacion.js'

test('Administración FOM queda primero con o sin una empresa seleccionada', () => {
  const menu = [{ grupo: 'Operación', items: [{ a: '/panel' }] }, { grupo: 'Flota', items: [{ a: '/panel/flota' }] },
    { grupo: 'Administración FOM', items: [{ a: '/panel/seleccionar-empresa' }, { a: '/panel/admin/empresas' }] }]
  for (const perfil of [{ rol: 'admin_fom' }, { rol: 'admin_fom', empresaGestion: { id: 'synthetic-company' } }]) {
    const organized = reorganizarMenu(menu, perfil)
    assert.equal(organized[0].grupo, 'Administración FOM')
    assert.equal(organized[0].items[0].a, '/panel/seleccionar-empresa')
    assert.ok(organized.some(g => g.grupo === 'Hardware y telemetría'))
  }
  assert.equal(menu[0].grupo, 'Operación')
})

test('ordenar el menú no agrega administración al supervisor', () => {
  const menu = [{ grupo: 'Operación', items: [{ a: '/panel' }] }, { grupo: 'Flota', items: [{ a: '/panel/flota' }] }]
  const organized = reorganizarMenu(menu, { rol: 'supervisor', empresaTipo: 'estandar' })
  assert.equal(organized[0].grupo, 'Operación')
  assert.equal(organized.some(g => g.grupo === 'Administración FOM'), false)
})
