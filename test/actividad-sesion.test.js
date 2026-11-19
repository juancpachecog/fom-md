import test from 'node:test'
import assert from 'node:assert/strict'
import { crearRelojInactividad, INACTIVIDAD_SESION_MS } from '../src/panel/actividadSesion.js'

function reloj() {
  let wall = 1000000, mono = 0, ends = 0, next = null
  const clock = crearRelojInactividad({ ahora: () => wall, monotono: () => mono,
    programar: (fn, ms) => { next = { fn, ms }; return 1 }, cancelar: () => { next = null }, alVencer: () => ends++ })
  return { clock, advance(ms) { wall += ms; mono += ms }, wall(ms) { wall += ms }, mono(ms) { mono += ms }, get ends() { return ends }, get next() { return next } }
}

test('vence exactamente a15min y comprobar/polling no renueva actividad', () => {
  const r = reloj()
  assert.equal(INACTIVIDAD_SESION_MS, 900000)
  r.advance(899999); assert.equal(r.clock.comprobar(), false); assert.equal(r.next.ms, 1)
  r.advance(1); assert.equal(r.clock.comprobar(), true); assert.equal(r.ends, 1)
  r.clock.comprobar(); assert.equal(r.ends, 1)
})

test('interacción anterior al límite renueva el plazo; volver después no revive la sesión', () => {
  const r = reloj()
  r.advance(899999); assert.equal(r.clock.actividad(), true)
  r.advance(900000); assert.equal(r.clock.actividad(), false); assert.equal(r.ends, 1)
})

test('recuperar foco tras suspensión comprueba el tiempo real aunque el timer no corriera', () => {
  const r = reloj(); r.wall(901000)
  assert.equal(r.clock.comprobar(), true); assert.equal(r.ends, 1)
})

test('atrasar el reloj de Windows no extiende15min y se rechazan tiempos futuros de otras pestañas', () => {
  const r = reloj(); r.wall(-3600000); r.mono(900000)
  assert.equal(r.clock.comprobar(), true)
  const other = reloj(); assert.equal(other.clock.actividad(2000000), false)
  other.advance(900000); assert.equal(other.clock.comprobar(), true)
})

test('detener elimina el temporizador y no dispara otra salida', () => {
  const r = reloj(); r.clock.detener(); assert.equal(r.next, null)
  r.advance(900000); r.clock.actividad(); assert.equal(r.ends, 0)
})

test('recargar conserva la última actividad y vence antes de aceptar otra interacción', () => {
  let ends = 0
  const clock = crearRelojInactividad({ ahora: () => 1000000, monotono: () => 0, ultimaActividad: 100000,
    autoIniciar: false, programar: () => 1, cancelar: () => {}, alVencer: () => ends++ })
  assert.equal(ends, 0)
  assert.equal(clock.actividad(), false)
  assert.equal(ends, 1)
})
