import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PUNTOS_CLAVE, armarComandos, buscarEquipos, calidadRecepcion, cifrasInventario, comprobacionesPrueba,
  coordenadasTexto, estadoEquipo, haceCuanto, huellaCorta, intervaloTexto, lecturaTrama, nombreEquipo,
  nombreProtocolo, senalDe, unirTramasConPosiciones, validarEquipo, validarIccid, validarImei, validarLinea,
  validarTelefono,
} from '../src/panel/datos/gps.js'

// T-95 · Inventario GPS: reglas puras del alta, la prueba y el diagnóstico.

const AHORA = new Date('2026-10-21T15:00:00Z').getTime()
const hace = (s) => new Date(AHORA - s * 1000).toISOString()

test('IMEI: 15 dígitos exactos, con mensajes llanos', () => {
  assert.deepEqual(validarImei('868166051450012'), { valor: '868166051450012', error: '' })
  assert.equal(validarImei(' 868166 051450-012 ').valor, '868166051450012')
  assert.match(validarImei('').error, /Detectados sin registrar/u)
  assert.match(validarImei('86816605145001').error, /tiene 15 dígitos; este tiene 14/u)
  assert.match(validarImei('8681660514500123').error, /este tiene 16/u)
  assert.match(validarImei('86816605145001A').error, /solo números/u)
})

test('ICCID: de 18 a 22 dígitos', () => {
  assert.equal(validarIccid('895802011904553721').error, '')
  assert.equal(validarIccid('8958020119045537216123').error, '')
  assert.match(validarIccid('89580201190455372').error, /18 a 22 dígitos; este tiene 17/u)
  assert.match(validarIccid('89580201190455372161234').error, /este tiene 23/u)
  for (const valor of ['', '   ', undefined, null]) assert.deepEqual(validarIccid(valor), { valor: '', error: '' })
  assert.match(validarIccid('8958-0201').error, /solo números/u)
})

test('teléfono de la línea: completo y sin letras', () => {
  assert.equal(validarTelefono('0414-5523187').error, '')
  assert.equal(validarTelefono('+58 414 5523187').error, '')
  assert.match(validarTelefono('').error, /número de la línea/u)
  assert.match(validarTelefono('0414-55').error, /no parece completo/u)
  assert.match(validarTelefono('0414-ABC1234').error, /solo dígitos/u)
})

test('paso 1 y paso 2: errores por campo, vacío cuando todo está bien', () => {
  assert.deepEqual(validarEquipo({ marca: 'Coban', modelo: 'GPS-403', imei: '868166051450012' }), {})
  assert.ok(validarEquipo({ marca: 'Otra', modelo: 'X', imei: '868166051450012' }).marca)
  assert.ok(validarEquipo({ marca: 'Coban', modelo: 'X', imei: '868166051450012' }).modelo)
  assert.ok(validarEquipo({ marca: 'Coban', modelo: 'GPS-403', imei: '123' }).imei)
  const linea = { telefono: '0414-5523187', iccid: '895804011904553118', operador: 'Movistar', apn: 'internet.movistar.ve', estadoSim: 'active' }
  assert.deepEqual(validarLinea(linea), {})
  for (const iccid of ['', '  ', undefined]) assert.deepEqual(validarLinea({ ...linea, iccid }), {})
  assert.ok(validarLinea({ ...linea, iccid: '123' }).iccid)
  assert.ok(validarLinea({ ...linea, apn: '' }).apn)
  assert.ok(validarLinea({ ...linea, apn: 'con espacio' }).apn)
  assert.ok(validarLinea({ ...linea, operador: ' ' }).operador)
  assert.ok(validarLinea({ ...linea, estadoSim: 'verificada' }).estadoSim)
})

test('comandos SMS: la clave va en lo que se copia y nunca en lo que se ve', () => {
  const c = armarComandos({ clave: '654321', apn: 'internet.movistar.ve', ip: '10.0.0.1', puerto: 5001, transporte: 'tcp' })
  assert.equal(c.length, 5)
  assert.deepEqual(c.map((x) => x.n), ['01', '02', '03', '04', '05'])
  assert.equal(c[0].texto, 'APN654321 internet.movistar.ve')
  assert.equal(c[1].texto, 'adminip654321 10.0.0.1 5001')
  assert.equal(c[2].texto, 'GPRS654321,0,0')
  assert.equal(c[3].texto, 'check654321')
  assert.equal(c[4].texto, 'imei654321')
  for (const x of c) {
    assert.doesNotMatch(x.visible, /654321/u)
    assert.ok(x.visible.includes(PUNTOS_CLAVE))
  }
  assert.equal(c[0].visible, `APN${PUNTOS_CLAVE} internet.movistar.ve`)
})

test('comandos SMS: UDP, clave de fábrica y receptor sin configurar', () => {
  const c = armarComandos({ apn: 'gprsweb.digitel.ve', transporte: 'udp' })
  assert.equal(c[2].texto, 'GPRS123456,1,1')
  assert.equal(c[2].titulo, 'Encender datos por UDP')
  assert.equal(c[1].texto, null)
  assert.match(c[1].falta, /no está configurado/u)
  for (const ip of ['', '999.1.1.1', '[IP del receptor]', 'host.invalid', '1.2.3.4\nSMS']) {
    assert.equal(armarComandos({ ip })[1].texto, null)
  }
  assert.equal(armarComandos({ ip: ' 192.0.2.24 ' })[1].texto, 'adminip123456 192.0.2.24 5001')
  assert.equal(c[3].respuesta, 'Debe decir GPRS ON y PORT 5001')
})

test('señal: la misma regla de 5 minutos y los textos del diseño', () => {
  assert.equal(haceCuanto(hace(40), AHORA), 'hace 40 s')
  assert.equal(haceCuanto(hace(3 * 3600), AHORA), 'hace 3 h')
  assert.equal(haceCuanto(null, AHORA), 'nunca reportó')
  assert.deepEqual(senalDe({ vehiculoId: 'v', ultimaConexion: hace(40) }, AHORA), { clave: 'con', tono: 'ok', texto: 'Con señal · hace 40 s' })
  assert.deepEqual(senalDe({ vehiculoId: 'v', ultimaConexion: hace(3 * 3600) }, AHORA), { clave: 'sin', tono: 'bad', texto: 'Sin señal · hace 3 h' })
  assert.equal(senalDe({ vehiculoId: 'v', ultimaConexion: hace(299) }, AHORA).clave, 'con')
  assert.equal(senalDe({ vehiculoId: 'v', ultimaConexion: hace(300) }, AHORA).clave, 'sin')
  assert.equal(senalDe({ vehiculoId: 'v', ultimaConexion: null }, AHORA).texto, 'Sin señal · nunca reportó')
  assert.equal(senalDe({ ultimaConexion: hace(6 * 86400) }, AHORA).texto, 'Probado · hace 6 d')
  assert.equal(senalDe({}, AHORA).texto, 'Nunca ha reportado')
})

test('cifras y filtros del inventario', () => {
  const lista = [
    { id: 1, vehiculoId: 'a', estado: 'active', ultimaConexion: hace(30) },
    { id: 2, vehiculoId: 'b', estado: 'active', ultimaConexion: hace(4000) },
    { id: 3, vehiculoId: null, estado: 'inventory', ultimaConexion: null },
    { id: 4, vehiculoId: null, estado: 'inactive', ultimaConexion: null },
  ]
  assert.deepEqual(cifrasInventario(lista, AHORA), { equipos: 4, conSenal: 1, sinSenal: 1, sinInstalar: 1 })
  const conLineas = [
    { imei: '868166051447290', linea: '0414-5523187', vehiculoNombre: 'Unidad 01 · Z69FC7W' },
    { imei: '868166051446018', linea: '0412-7710342', vehiculoNombre: 'Unidad 08 · V88AS5T' },
  ]
  assert.equal(buscarEquipos(conLineas, '7290').length, 1)
  assert.equal(buscarEquipos(conLineas, 'unidad 08')[0].imei, '868166051446018')
  assert.equal(buscarEquipos(conLineas, '04127710342').length, 1)
  assert.equal(buscarEquipos(conLineas, '').length, 2)
})

test('nombres y estados en llano', () => {
  assert.equal(nombreEquipo({ fabricante: 'Coban', modelo: 'GPS-403' }), 'Coban GPS-403')
  assert.equal(nombreEquipo({ fabricante: 'Teltonika', modelo: 'Teltonika FMB920' }), 'Teltonika FMB920')
  assert.equal(nombreEquipo({ modelo: 'GT06N' }), 'GT06N')
  assert.equal(nombreProtocolo('coban-gps103'), 'Coban GPS103')
  assert.equal(nombreProtocolo('otro'), 'otro')
  assert.deepEqual(estadoEquipo('inventory'), { texto: 'En inventario', tono: 'info' })
  assert.equal(estadoEquipo('active').texto, 'Activo')
  assert.equal(estadoEquipo('raro').texto, 'raro')
})

test('lectura de la trama, con lo que dijo su posición', () => {
  assert.equal(lecturaTrama('coban-gps103 · heartbeat'), 'Latido (sin posición)')
  assert.equal(lecturaTrama('coban-gps103 · position_valid', { velocidad: 0, encendido: false }), 'Posición válida · 0 km/h · motor apagado')
  assert.equal(lecturaTrama('coban-gps103 · position_valid', { velocidad: 12, rumbo: 120 }), 'Posición válida · 12 km/h · rumbo 120°')
  assert.equal(lecturaTrama('coban-gps103 · malformed · bad_checksum'), 'Trama que no se entiende')
  assert.equal(lecturaTrama(''), 'Sin leer todavía')
})

test('calidad de recepción: medida entre tramas, no contra la hora de ahora', () => {
  const tramas = (n, cada, inicio = 0) => Array.from({ length: n }, (_, i) => ({ recibido: hace(inicio + i * cada), diagnostico: 'coban-gps103 · position_valid' }))
  // Cada 30 s sin huecos, aunque la última sea de hace 3 h: «Muy buena» y 100 %.
  const buena = calidadRecepcion(tramas(50, 30, 3 * 3600))
  assert.equal(buena.porcentaje, 100)
  assert.equal(buena.etiqueta, 'Muy buena')
  assert.equal(buena.muestras, 50)
  assert.equal(Math.round(buena.intervaloS), 30)
  assert.equal(buena.mensajesPorHora, 122)
  assert.equal(buena.imeiCoincidePct, 100)
  // Cada 4 min: sin continuidad y regularidad media → deficiente.
  const mala = calidadRecepcion(tramas(10, 240))
  assert.equal(mala.porcentaje, 45)
  assert.equal(mala.etiqueta, 'Deficiente')
  // Una sola trama no alcanza para medir.
  assert.equal(calidadRecepcion(tramas(1, 30)).porcentaje, null)
  assert.equal(calidadRecepcion([]).etiqueta, 'Sin datos suficientes')
  assert.equal(intervaloTexto(30), '30 s')
  assert.equal(intervaloTexto(240), '4 min')
})

test('comprobaciones de la prueba: no marca la huella si el servidor no la dio', () => {
  const telemetria = { imei: '868166051450012', mensajes: [{ recibido: hace(8), fresco: true }] }
  const sinHuella = comprobacionesPrueba({ telemetria, imei: '868166051450012', ahora: AHORA })
  assert.deepEqual(sinHuella.map((c) => c.ok), [true, true, true, false])
  const conHuella = comprobacionesPrueba({ telemetria, imei: '868166051450012', huella: 'ab'.repeat(32), ahora: AHORA })
  assert.equal(conHuella[3].ok, true)
  const otro = comprobacionesPrueba({ telemetria, imei: '868166051449999', ahora: AHORA })
  assert.equal(otro[1].ok, false)
  const vieja = comprobacionesPrueba({ telemetria: { mensajes: [{ recibido: hace(600), fresco: false }] }, imei: 'x', ahora: AHORA })
  assert.equal(vieja[0].ok, false)
  assert.deepEqual(comprobacionesPrueba({ telemetria: null, imei: 'x', ahora: AHORA }).map((c) => c.ok), [false, false, false, false])
})

test('piezas chicas: huella corta, coordenadas y unión de tramas con posiciones', () => {
  assert.equal(huellaCorta('9f2c84e1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab7c041ad'), '9f2c84e1…b7c041ad')
  assert.equal(coordenadasTexto(10.6427, -71.6125), '10,6427 N 71,6125 O')
  assert.equal(coordenadasTexto(NaN, 1), '')
  const t = hace(30)
  const [m] = unirTramasConPosiciones([{ id: 1, recibido: t }], [{ recibido: t, velocidad: 0 }])
  assert.equal(m.posicion.velocidad, 0)
  assert.equal(unirTramasConPosiciones([{ id: 2, recibido: hace(60) }], [])[0].posicion, null)
})
