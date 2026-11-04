import { test } from 'node:test'
import assert from 'node:assert/strict'
import { empresaDeReinicio, mensajeReiniciarClave } from '../src/panel/datos/reiniciarClave.js'
import { aRutaPorEnte } from '../src/panel/datos/rutaPorEnte.js'

// T-210 · El administrador global no podía restablecer la clave de gente de otra empresa:
// la ruta sin empresa solo halla a la gente de la empresa propia y daba 404.

const PROPIA = '10000000-0000-4000-8000-000000000001'
const OTRA = '20000000-0000-4000-8000-000000000002'
const U = '30000000-0000-4000-8000-000000000003'
const C = '/api/v1/console'
const RUTA = `${C}/users/${U}/credential-reset`
const error = (estado, message = 'x') => Object.assign(new Error(message), { estado })

test('persona de otra empresa: viaja por la ruta de su empresa', () => {
  const destino = empresaDeReinicio(OTRA, PROPIA)
  assert.equal(destino, OTRA)
  // El contexto explícito es el que usa `pedir`: la empresa queda en la ruta.
  assert.equal(aRutaPorEnte(RUTA, 'POST', destino), `${C}/tenants/${OTRA}/users/${U}/credential-reset`)
})

test('persona de la empresa propia: ruta propia, aunque el administrador esté dentro de otra', () => {
  assert.equal(empresaDeReinicio(PROPIA, PROPIA), null)
  // `null` desactiva el contexto: la ruta sale tal cual.
  assert.equal(aRutaPorEnte(RUTA, 'POST', null), RUTA)
})

test('sin empresa de la persona usa contexto; con destino conocido lo conserva aunque falte la propia', () => {
  assert.equal(empresaDeReinicio(null, PROPIA), undefined)
  assert.equal(empresaDeReinicio('', PROPIA), undefined)
  assert.equal(empresaDeReinicio(OTRA, null), OTRA)
})

test('errores del servidor, en llano', () => {
  assert.match(mensajeReiniciarClave(error(404, 'Ese recurso no existe en el servidor.')), /No se encontró a esa persona/)
  assert.match(mensajeReiniciarClave(error(409, 'That person has no credential to reset')), /no tiene una clave creada/)
  assert.match(mensajeReiniciarClave(error(403, 'Tu sesión no tiene permiso')), /rango menor/)
  // Lo que ya viene claro se respeta.
  const sinRuta = 'Esta función todavía no está en el servidor publicado. Ya está construida y espera el despliegue.'
  assert.equal(mensajeReiniciarClave(error(404, sinRuta)), sinRuta)
  assert.equal(mensajeReiniciarClave(error(0, 'No se pudo conectar con el servidor.')), 'No se pudo conectar con el servidor.')
  assert.equal(mensajeReiniciarClave(undefined), 'No se pudo restablecer la clave.')
})
