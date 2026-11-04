import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { normalizarPeticion, puedeAceptar, resultadoDe } from '../src/panel/comp/logicaConfirmar.js'

// ============================================================
// T-216: confirmaciones propias en lugar de las del navegador
// En navegadores incrustados las ventanas confirm/prompt/alert se cancelan solas
// y devuelven false sin mostrarse: «Reactivar servicio» parecía no hacer nada.
// ============================================================

const raiz = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1')

test('normalizarPeticion pone valores por defecto en llano', () => {
  const p = normalizarPeticion({ titulo: 'Reactivar servicio', texto: '¿Seguro?', accion: 'Reactivar' })
  assert.equal(p.titulo, 'Reactivar servicio')
  assert.equal(p.accion, 'Reactivar')
  assert.equal(p.cancelar, 'Cancelar')
  assert.equal(p.peligro, false)
  assert.equal(p.campo, null)
  const vacia = normalizarPeticion()
  assert.equal(vacia.accion, 'Confirmar')
  assert.equal(vacia.texto, '')
})

test('la variante de peligro y el campo se conservan', () => {
  const p = normalizarPeticion({ peligro: true, campo: { etiqueta: 'Referencia', obligatorio: true } })
  assert.equal(p.peligro, true)
  assert.deepEqual(p.campo, { etiqueta: 'Referencia', obligatorio: true, placeholder: '' })
})

test('sin campo: true al aceptar, false al cancelar', () => {
  const p = normalizarPeticion({ accion: 'Reactivar' })
  assert.equal(resultadoDe(p, true), true)
  assert.equal(resultadoDe(p, false), false)
})

test('con campo: devuelve el texto recortado o null al cancelar', () => {
  const p = normalizarPeticion({ campo: { etiqueta: 'Referencia', obligatorio: true } })
  assert.equal(resultadoDe(p, true, '  ABC-123 '), 'ABC-123')
  assert.equal(resultadoDe(p, false, 'ABC-123'), null)
})

test('un campo obligatorio vacío no se puede aceptar', () => {
  const p = normalizarPeticion({ campo: { etiqueta: 'Referencia', obligatorio: true } })
  assert.equal(puedeAceptar(p, ''), false)
  assert.equal(puedeAceptar(p, '   '), false)
  assert.equal(puedeAceptar(p, 'X'), true)
  assert.equal(resultadoDe(p, true, '  '), null)
  const opcional = normalizarPeticion({ campo: { etiqueta: 'Motivo' } })
  assert.equal(puedeAceptar(opcional, ''), true)
  assert.equal(resultadoDe(opcional, true, ''), '')
})

function archivos(dir) {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) return archivos(ruta)
    return /\.(jsx?|tsx?|mjs)$/u.test(nombre) ? [ruta] : []
  })
}

test('src/ no vuelve a usar window.confirm, window.prompt ni window.alert', () => {
  const prohibido = /\bwindow\s*\.\s*(confirm|prompt|alert)\b|(?<![.\w])(confirm|prompt|alert)\s*\(/u
  const culpables = archivos(join(raiz, 'src')).filter((ruta) => prohibido.test(readFileSync(ruta, 'utf8')))
  assert.deepEqual(culpables, [], 'Usa useConfirmar() de src/panel/comp/Confirmar.jsx')
})

test('los módulos de administración usan useConfirmar', () => {
  for (const modulo of ['AdminEmpresas', 'AdminPagos', 'AdminUsuarios']) {
    const fuente = readFileSync(join(raiz, 'src/panel/modulos', `${modulo}.jsx`), 'utf8')
    assert.match(fuente, /useConfirmar\(\)/u, modulo)
  }
})
