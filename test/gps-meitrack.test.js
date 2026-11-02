import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CATALOGO_GPS, nombreProtocolo } from '../src/panel/datos/gps.js'
import {
  AVISO_RUTA_AUSENTE, MEITRACK, armarComandosMeitrack, consultaMeitrack, cuerpoAltaMeitrack, db4Configurado,
  esMeitrack, lecturaDb4, listaComandos, mensajeMeitrack, receptorValido, resumenRecepcion, rutaAusente,
  smsConexion, smsRestauracion, validarApnMeitrack, validarClaveMeitrack, ventanaUsable,
} from '../src/panel/datos/gpsMeitrack.js'

// T-211 · Alta del Meitrack T399L: comandos de Juan (fom-core apps/gps-web), ventana y mensajes llanos.

const IMEI = '868166051450012'
const IP = '203.0.113.7'
const celdas = (tipo, ip, puerto, apn) => [IMEI, 'DB4', tipo, `IP1:${ip}`, `PORT1:${puerto}`, 'IP2:', 'PORT2:', '30', apn, '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '']
const db4Antes = celdas('CLOSE', '198.51.100.9', '5000', 'internet.movistar.ve').join(',')
const db4Despues = celdas('TCP', IP, '5002', 'gprsweb.digitel.ve').join(',')

test('el catálogo trae el Meitrack T399L con su protocolo', () => {
  assert.equal(CATALOGO_GPS.Meitrack.T399L.protocolo, 'meitrack-t399')
  assert.equal(nombreProtocolo('meitrack-t399'), 'Meitrack T399')
  assert.equal(CATALOGO_GPS.Coban['GPS-403'].protocolo, 'coban-gps103')
  assert.ok(esMeitrack('Meitrack', 'T399L'))
  assert.ok(!esMeitrack('Coban', 'GPS-403'))
})

test('contraseña SMS: cuatro dígitos, sin clave de fábrica', () => {
  assert.equal(validarClaveMeitrack('0000').error, '')
  assert.match(validarClaveMeitrack('').error, /contraseña SMS/u)
  assert.match(validarClaveMeitrack('123456').error, /4 números/u)
  assert.match(validarClaveMeitrack('12a4').error, /4 números/u)
})

test('APN y receptor: lo que acepta el comando de conexión', () => {
  assert.equal(validarApnMeitrack('internet.movistar.ve').error, '')
  assert.ok(validarApnMeitrack('').error)
  assert.ok(validarApnMeitrack('con espacio').error)
  assert.ok(validarApnMeitrack('-raro').error)
  assert.ok(receptorValido(IP))
  assert.ok(!receptorValido(''))
  assert.ok(!receptorValido('receptor.fom.com'))
  assert.ok(!receptorValido('300.1.1.1'))
})

test('E04: lista de códigos de 3 caracteres; otra cosa no pasa', () => {
  assert.deepEqual(listaComandos('A00, db4,DA6,E91,db4'), ['A00', 'DB4', 'DA6', 'E91'])
  assert.deepEqual(listaComandos(''), [])
  assert.equal(listaComandos(`${IMEI},E04,A00`), null)
  assert.equal(listaComandos('A0'), null)
})

test('consultas de solo lectura: DB4 y DA6 solo si el equipo las anunció', () => {
  assert.equal(consultaMeitrack('0000', 'E91'), '0000,E91')
  assert.equal(consultaMeitrack('0000', 'E04'), '0000,E04')
  assert.equal(consultaMeitrack('0000', 'DB4'), null)
  assert.equal(consultaMeitrack('0000', 'DB4', ['DB4']), '0000,DB4')
  assert.equal(consultaMeitrack('00', 'E91'), null)
  assert.equal(consultaMeitrack('0000', 'A21', ['A21']), null)
})

test('DB4: acepta la lectura de este equipo y rechaza lo demás', () => {
  assert.ok(lecturaDb4(db4Antes, IMEI))
  assert.equal(lecturaDb4(db4Antes, '868166051450099'), null)
  assert.equal(lecturaDb4(db4Despues, IMEI), null, 'antes de configurar debe decir CLOSE')
  assert.ok(lecturaDb4(db4Despues, IMEI, 'TCP'))
  assert.equal(lecturaDb4('algo,suelto', IMEI), null)
  assert.equal(lecturaDb4(db4Antes.replace('IP1:198.51.100.9', 'IP1:no-es-ip'), IMEI), null)
})

test('restauración: devuelve destino y APN de la primera lectura, con GPRS apagado', () => {
  const base = lecturaDb4(db4Antes, IMEI)
  assert.equal(smsRestauracion('0000', base, IMEI, true), '0000,A21,0,198.51.100.9,5000,internet.movistar.ve,,')
  assert.equal(smsRestauracion('0000', base, IMEI, false), null, 'sin confirmar que el APN no lleva usuario ni clave')
  assert.equal(smsRestauracion('0000', null, IMEI, true), null)
  assert.equal(smsRestauracion('abcd', base, IMEI, true), null)
})

test('conexión: A21,1 con la IP del receptor, el puerto 5002 y el APN', () => {
  assert.equal(smsConexion({ clave: '0000', ip: IP, apn: 'gprsweb.digitel.ve' }), `0000,A21,1,${IP},5002,gprsweb.digitel.ve,,`)
  assert.equal(smsConexion({ clave: '0000', ip: '', apn: 'x' }), null)
  assert.equal(smsConexion({ clave: '0000', ip: IP, apn: 'con espacio' }), null)
})

test('DB4 de después: solo vale si cambió lo previsto y nada más', () => {
  const base = lecturaDb4(db4Antes, IMEI)
  const destino = { ip: IP, puerto: 5002 }
  assert.ok(db4Configurado(db4Despues, base, IMEI, 'gprsweb.digitel.ve', destino))
  assert.ok(!db4Configurado(db4Despues, base, IMEI, 'otro.apn', destino))
  assert.ok(!db4Configurado(db4Despues.replace('PORT1:5002', 'PORT1:5001'), base, IMEI, 'gprsweb.digitel.ve', destino))
  assert.ok(!db4Configurado(db4Despues.replace(',30,', ',31,'), base, IMEI, 'gprsweb.digitel.ve', destino))
  assert.ok(!db4Configurado(db4Antes, base, IMEI, 'internet.movistar.ve', destino), 'CLOSE no es TCP')
})

const ventana = (extra = {}) => ({
  ready: true, reason: null, serverNow: '2026-11-02T15:00:00.000Z', activationAllowed: false,
  window: {
    reference: 'issue/727/prueba', expiresAt: '2026-11-02T15:30:00.000Z', firmware: 'T399L-V254',
    destination: { host: IP, port: 5002, transport: 'tcp' }, remainingConnections: 5, acknowledgementAllowed: false, ...extra,
  },
})

test('ventana de recepción: abierta, con tiempo y lectura reciente', () => {
  assert.ok(ventanaUsable(ventana(), 2000))
  assert.ok(!ventanaUsable(ventana(), 20_000), 'lectura vieja')
  assert.ok(!ventanaUsable(ventana({ expiresAt: '2026-11-02T15:01:00.000Z' }), 1000), 'quedan menos de 90 s')
  assert.ok(!ventanaUsable(ventana({ destination: { host: IP, port: 5001, transport: 'tcp' } }), 1000))
  assert.ok(!ventanaUsable({ ready: false, reason: 'not_ready', window: null }, 1000))
  assert.ok(!ventanaUsable(null, 1000))
})

test('comandos del paso 2: la contraseña va en lo copiado y nunca en lo visible; cada uno con su bloqueo', () => {
  const base = lecturaDb4(db4Antes, IMEI)
  const todo = { clave: '4321', anunciados: ['A21', 'DB4', 'E91'], base, sinUsuarioNiClave: true, restauracionGuardada: true, apn: 'gprsweb.digitel.ve', ip: IP, ventana: true }
  const c = armarComandosMeitrack(todo)
  assert.deepEqual(c.map((x) => x.n), ['01', '02', '03', '04', '05', '06'])
  assert.deepEqual(c.map((x) => x.texto), [
    '4321,E91', '4321,E04', '4321,DB4',
    '4321,A21,0,198.51.100.9,5000,internet.movistar.ve,,',
    `4321,A21,1,${IP},5002,gprsweb.digitel.ve,,`,
    '4321,DB4',
  ])
  for (const x of c) {
    assert.ok(!x.falta)
    assert.ok(!x.visible.includes('4321'))
    assert.ok(x.visible.includes('······'))
  }
  // Sin contraseña no se puede copiar nada.
  assert.ok(armarComandosMeitrack({ ...todo, clave: '' }).every((x) => x.falta && x.texto === null))
  // Sin E04 con DB4, ni la lectura ni la comprobación.
  const sinE04 = armarComandosMeitrack({ ...todo, anunciados: [] })
  assert.ok(sinE04[2].falta && sinE04[5].falta && sinE04[4].falta)
  // La conexión espera la restauración guardada, la ventana y la IP.
  assert.match(armarComandosMeitrack({ ...todo, restauracionGuardada: false })[4].falta, /restauración/u)
  assert.match(armarComandosMeitrack({ ...todo, ventana: false })[4].falta, /ventana/u)
  assert.match(armarComandosMeitrack({ ...todo, ip: '' })[4].falta, /IP del receptor/u)
  assert.match(armarComandosMeitrack({ ...todo, base: null })[3].falta, /DB4/u)
  assert.match(armarComandosMeitrack({ ...todo, sinUsuarioNiClave: false })[3].falta, /sin usuario ni clave/u)
})

test('recepción: sin ventana, esperando o recibida', () => {
  assert.equal(resumenRecepcion(null).estado, 'sin-ventana')
  assert.equal(resumenRecepcion({ capture: { windowAvailable: false, received: false, messages: [] } }).estado, 'sin-ventana')
  assert.equal(resumenRecepcion({ capture: { windowAvailable: true, received: false, messages: [] } }).estado, 'esperando')
  const m = { receiptId: '7', receivedAt: '2026-11-02T15:05:00.000Z', bytes: 120, sha256: 'a'.repeat(64), records: 2 }
  const r = resumenRecepcion({ capture: { windowAvailable: true, received: true, messages: [m] } })
  assert.equal(r.estado, 'recibida')
  assert.equal(r.ultima.receiptId, '7')
})

test('el alta lleva solo inventario: firmware fijo, TCP y nada de vehículo', () => {
  const c = cuerpoAltaMeitrack({ imei: '868 166 051 450 012', telefono: ' 0414-5523187 ', iccid: '8958 0401 1904 5531 18', operador: 'Digitel', apn: 'gprsweb.digitel.ve', serie: '', plan: '' })
  assert.deepEqual(c, {
    imei: IMEI, simPhone: '0414-5523187', iccid: '895804011904553118', carrier: 'Digitel', apn: 'gprsweb.digitel.ve', simStatus: 'active',
    manufacturer: 'Meitrack', model: 'T399L', protocolFamily: 'meitrack-t399', firmwareVersion: MEITRACK.firmware, transport: 'tcp',
  })
  assert.ok(!Object.keys(c).some((k) => k.startsWith('vehicle') || k === 'installedAt' || k === 'technician'))
})

test('ruta ausente: 404 y «Cannot POST» se avisan en llano, no como error técnico', () => {
  assert.ok(rutaAusente({ estado: 404, message: 'Esta función todavía no está en el servidor publicado. Ya está construida y espera el despliegue.' }))
  assert.ok(rutaAusente({ estado: 501, message: 'x' }))
  assert.ok(rutaAusente({ message: 'Cannot POST /api/v1/console/meitrack-setup/readiness' }))
  assert.ok(!rutaAusente({ estado: 409, message: 'x' }))
  assert.ok(!rutaAusente(null))
  assert.equal(mensajeMeitrack({ estado: 404, message: 'Ese recurso no existe en el servidor.' }), 'El registro de Meitrack todavía no está en el servidor publicado.')
  assert.equal(AVISO_RUTA_AUSENTE, 'El registro de Meitrack todavía no está en el servidor publicado.')
})

test('errores del servidor dichos en español llano', () => {
  assert.match(mensajeMeitrack({ estado: 409, message: 'Matching TEST capture required before registration' }), /no llegó la señal de prueba/u)
  assert.match(mensajeMeitrack({ estado: 409, message: 'Registration requires an independently confirmed absent record' }), /ya figura en el inventario/u)
  assert.match(mensajeMeitrack({ estado: 400, message: 'Only Meitrack T399L-V254 inventory registration is available here' }), /T399L con firmware T399L-V254/u)
  assert.match(mensajeMeitrack({ estado: 409, message: 'otra cosa' }), /ya existe un equipo/u)
  assert.match(mensajeMeitrack({ estado: 400, message: 'bad request' }), /Revisa el IMEI/u)
  assert.equal(mensajeMeitrack({ estado: 403, message: 'Tu sesión no tiene permiso para esta operación.' }), 'Tu sesión no tiene permiso para esta operación.')
  for (const e of [{ estado: 409, message: 'Matching TEST capture required' }, { estado: 400, message: 'x' }]) {
    assert.doesNotMatch(mensajeMeitrack(e), /TEST capture|Only Meitrack|bad request/u)
  }
})
