import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conRecepcionEquipo, conRecepcionFlota } from '../src/panel/datos/recepcionUnidad.js'
import { estadoUnidad } from '../src/panel/datos/estadoUnidad.js'
const ahora=Date.parse('2026-11-04T00:40:00Z')
const unidad={id:'vehiculo',empresaId:'empresa',ultimoReporte:null,lat:null,lng:null,velocidadKmh:null,estadoMarcha:null}
const equipo={vehicleId:'vehiculo',operatingTenantId:'empresa',installationId:'instalacion',protocolFamily:'meitrack-t399',installedAt:'2026-11-03T12:00:00Z',lastConnectionAt:'2026-11-04T00:39:30Z'}
test('recepción comprobada muestra reportando sin inventar posición ni movimiento',()=>{
 const v=conRecepcionEquipo(unidad,equipo,{state:'clock_pending'},ahora)
 assert.equal(v.conectado,true);assert.equal(estadoUnidad(v).texto,'Reportando')
 assert.equal(v.ubicacionGps.state,'clock_pending');assert.equal(v.lat,null);assert.equal(v.lng,null)
 assert.equal(v.velocidadKmh,null);assert.equal(v.estadoMarcha,null);assert.equal(v.posicionEn,undefined)
 assert.equal(conRecepcionEquipo(unidad,equipo,null,ahora+300000).conectado,false)
})
test('no mezcla empresas, equipos, instalación anterior ni fechas futuras',()=>{
 for(const cambio of [{vehicleId:'otro'},{operatingTenantId:'otra'},{installationId:null},{lastConnectionAt:'2026-11-03T11:00:00Z'},{lastConnectionAt:'2026-11-04T00:41:00Z'}])
  assert.equal(conRecepcionEquipo(unidad,{...equipo,...cambio},null,ahora),unidad)
})
test('recibir otra trama no rejuvenece la velocidad o marcha de una posición antigua',()=>{
 const v=conRecepcionEquipo({...unidad,ultimoReporte:'2026-11-03T12:01:00Z',lat:1,lng:2,velocidadKmh:80,estadoMarcha:'en_marcha'},equipo,null,ahora)
 assert.equal(estadoUnidad(v).texto,'Reportando');assert.equal(v.estadoMarcha,null)
 assert.equal(v.lat,1);assert.equal(v.lng,2)
})

test('flota conserva unidades sin GPS y rechaza instalaciones ambiguas o de otra empresa',()=>{
 const sinGps={id:'sin-gps',lat:null,lng:null,ultimoReporte:null}
 const lista=conRecepcionFlota([unidad,sinGps],[equipo],'empresa',ahora)
 assert.equal(estadoUnidad(lista[0]).texto,'Reportando')
 assert.equal(lista[0].lat,null);assert.equal(lista[0].velocidadKmh,null)
 assert.equal(lista[1],sinGps)
 assert.equal(conRecepcionFlota([unidad],[equipo,equipo],'empresa',ahora)[0],unidad)
 assert.equal(conRecepcionFlota([unidad],[equipo],'otra',ahora)[0],unidad)
 assert.equal(conRecepcionFlota([unidad],[],'empresa',ahora)[0],unidad)
})

test('heartbeat Coban fresco conserva posición histórica sin rejuvenecer movimiento',()=>{
 const posicionEn='2026-11-03T12:01:00Z'
 const v=conRecepcionEquipo({...unidad,ultimoReporte:posicionEn,posicionEn,lat:1,lng:2,velocidadKmh:80,estadoMarcha:'en_marcha',ignition:true},{...equipo,protocolFamily:'coban-gps103'},null,ahora)
 assert.equal(v.conectado,true);assert.equal(estadoUnidad(v).texto,'Reportando')
 assert.equal(v.ultimoReporte,equipo.lastConnectionAt);assert.equal(v.posicionEn,posicionEn)
 assert.equal(v.lat,1);assert.equal(v.lng,2)
 assert.equal(v.velocidadKmh,null);assert.equal(v.estadoMarcha,null);assert.equal(v.ignition,null)
 assert.equal(conRecepcionEquipo(v,{...equipo,protocolFamily:'coban-gps103'},null,ahora+300000).conectado,false)
 assert.equal(conRecepcionEquipo(unidad,{...equipo,protocolFamily:'unknown'},null,ahora),unidad)
})

test('señal actual no sustituye la fecha independiente de posición para la marcha',()=>{
 const v=conRecepcionEquipo({...unidad,ultimoReporte:equipo.lastConnectionAt,posicionEn:'2026-11-03T12:00:00Z',velocidadKmh:60,estadoMarcha:'en_marcha'},equipo,null,ahora)
 assert.equal(v.soloRecepcion,true);assert.equal(v.velocidadKmh,null);assert.equal(v.estadoMarcha,null)
})
