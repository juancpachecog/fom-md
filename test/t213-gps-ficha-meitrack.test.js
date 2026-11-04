import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PUERTO_RECEPTOR } from '../src/panel/datos/gps.js'
import { esEquipoMeitrack, puertoDelEquipo } from '../src/panel/datos/gpsMeitrack.js'

// T-213 · La ficha de un GPS ya registrado distingue el Meitrack T399L (puerto 5002) del Coban (5001).

const coban = { fabricante: 'Coban', modelo: 'GPS-403', protocolo: 'coban-gps103', transport: 'tcp' }
const meitrack = { fabricante: 'Meitrack', modelo: 'T399L', protocolo: 'meitrack-t399', transport: 'tcp' }

test('un Meitrack se reconoce por marca, modelo, protocolo o puerto 5002', () => {
  assert.ok(esEquipoMeitrack(meitrack))
  assert.ok(esEquipoMeitrack({ fabricante: 'meitrack' }))
  assert.ok(esEquipoMeitrack({ modelo: 'T399L' }))
  assert.ok(esEquipoMeitrack({ modelo: 'Meitrack T399L' }))
  assert.ok(esEquipoMeitrack({ protocolo: 'meitrack-t399' }))
  assert.ok(esEquipoMeitrack({ puerto: 5002 }))
  assert.ok(esEquipoMeitrack({ port: '5002' }))
})

test('el Coban y lo desconocido no se toman por Meitrack', () => {
  assert.ok(!esEquipoMeitrack(coban))
  assert.ok(!esEquipoMeitrack({ puerto: 5001 }))
  assert.ok(!esEquipoMeitrack({}))
  assert.ok(!esEquipoMeitrack(null))
  assert.ok(!esEquipoMeitrack(undefined))
})

test('el puerto del receptor: 5002 el Meitrack, 5001 el Coban', () => {
  assert.equal(puertoDelEquipo(meitrack), 5002)
  assert.equal(puertoDelEquipo(coban), PUERTO_RECEPTOR)
  assert.equal(PUERTO_RECEPTOR, 5001)
})

test('«Probar» y la ficha usan lo de Meitrack y dejan el Coban igual', () => {
  const probar = readFileSync(new URL('../src/panel/modulos/AdminGpsProbar.jsx', import.meta.url), 'utf8')
  assert.match(probar, /esEquipoMeitrack\(props\.equipo\) \? <ComandosMeitrackFicha/u)
  assert.match(probar, /armarComandos\(\{ clave, apn: equipo\.apn \?\? '', ip: IP_RECEPTOR, puerto: PUERTO_RECEPTOR/u)
  const detalle = readFileSync(new URL('../src/panel/modulos/AdminGpsDetalle.jsx', import.meta.url), 'utf8')
  assert.match(detalle, /puertoDelEquipo\(g\)/u)
  assert.doesNotMatch(detalle, /PORT \{PUERTO_RECEPTOR\}/u)
})
