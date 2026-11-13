import test from 'node:test'
import assert from 'node:assert/strict'
import { empresaActiva } from '../src/panel/datos/empresaActiva.js'

test('la empresa seleccionada prevalece sobre la propia al cambiar o salir del contexto', () => {
  const perfil = { empresa: 'Plataforma', empresaGestion: { id: 'a', nombre: 'Empresa A' } }
  assert.equal(empresaActiva(perfil, true), 'Empresa A')
  assert.equal(empresaActiva({ ...perfil, empresaGestion: { id: 'b', nombre: 'Empresa B' } }, true), 'Empresa B')
  assert.equal(empresaActiva({ ...perfil, empresaGestion: null }, true), 'Sin empresa seleccionada · Administración global')
  assert.equal(empresaActiva({ empresa: 'Empresa propia' }), 'Empresa propia')
})

test('el nombre ausente no se sustituye por una empresa ajena y el texto largo se conserva completo', () => {
  assert.equal(empresaActiva({ empresa: 'Plataforma', empresaGestion: { id: 'a' } }, true), 'Empresa seleccionada')
  assert.equal(empresaActiva(null), 'Empresa no disponible')
  const nombre = 'Empresa de operaciones '.repeat(12)
  assert.equal(empresaActiva({ empresaGestion: { nombre } }, true), nombre.trim())
})
