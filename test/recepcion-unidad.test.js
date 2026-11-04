import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conRecepcionEquipo } from '../src/panel/datos/recepcionUnidad.js'
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
