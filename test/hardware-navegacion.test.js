import test from 'node:test'
import assert from 'node:assert/strict'
import { menuHardware, reorganizarMenu, pestanaEquipo } from '../src/panel/hardware-navegacion.js'

test('inventario, pruebas y perfiles conservan alcance global exclusivo', () => {
  const admin = menuHardware({ rol: 'admin_fom' })
  assert.equal(admin.items.length, 4)
  for (const rol of ['owner', 'administrator', 'fleet_manager', 'supervisor']) {
    const hardware = menuHardware({ rol, empresaTipo: 'estandar' })
    assert.deepEqual(hardware.items.map(i => i.a), ['/panel/funciones'])
    for (const empresaTipo of ['personal', 'predefinida']) assert.equal(menuHardware({ rol, empresaTipo }), null)
  }
  for (const rol of ['operator', 'conductor', 'viewer', 'usuario', null]) assert.equal(menuHardware({ rol }), null)
})

test('administrador en empresa conserva un único catálogo y etiquetas bajo Flota sin mutar el menú base', () => {
  const base = [{ grupo: 'Flota', items: [{ a: '/panel/flota' }, { a: '/panel/funciones', soloGestor: true }] },
    { grupo: 'Usuarios', items: [{ a: '/panel/personal' }] },
    { grupo: 'Administración FOM', items: [{ a: '/panel/admin/funciones' }, { a: '/panel/admin/gps' }, { a: '/panel/admin/empresas' }] }]
  const before = structuredClone(base)
  const menu = reorganizarMenu(base, { rol: 'admin_fom', empresaGestion: { id: 'empresa' } })
  const links = menu.flatMap(g => g.items.map(i => i.a))
  assert.equal(new Set(links).size, links.length)
  assert.equal(links.filter(a => /\/funciones$/u.test(a)).length, 1)
  assert.equal(menu.find(g => g.grupo === 'Flota').items.at(-1).a, '/panel/admin/etiquetas')
  assert.equal(menu.find(g => g.grupo === 'Administración FOM').items.length, 1)
  assert.deepEqual(base, before)
})

test('operador no obtiene catálogo ni etiquetas por reagrupar y móvil recibe las mismas entradas', () => {
  const base = [{ grupo: 'Flota', items: [{ a: '/panel/flota' }, { a: '/panel/funciones', soloGestor: true }] }]
  const menu = reorganizarMenu(base, { rol: 'operator' })
  assert.deepEqual(menu[0].items.map(i => i.a), ['/panel/flota'])
  assert.equal(menu.length, 1)
  const admin = reorganizarMenu([], { rol: 'admin_fom' })
  assert.ok(admin.find(g => g.grupo === 'Hardware y telemetría').items.every(i => !i.soloEscritorio))
})

test('enlaces de prueba abren la pestaña correcta y un valor ajeno vuelve a diagnóstico', () => {
  for (const value of ['diagnostico', 'datos', 'funciones', 'comandos', 'historial']) assert.equal(pestanaEquipo(`vista=${value}`), value)
  for (const query of ['', 'vista=otra', 'vista=__proto__', 'vista=https://example.invalid']) assert.equal(pestanaEquipo(query), 'diagnostico')
})
