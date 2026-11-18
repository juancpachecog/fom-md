import {test} from 'node:test'
import assert from 'node:assert/strict'
import {apiAutodeteccion} from '../src/panel/datos/gpsAutodeteccion.js'
import {fechaHoraEquipo,horaGps,muestraTramaVigente,ubicacionTrama,motivoRevision} from '../src/panel/datos/revisionTramaGps.js'
const now=Date.parse('2026-11-18T22:36:45Z'),id='00000000-0000-4000-8000-000000000846'
const snapshot={privatePosition:true,validation:{canRegister:true},sample:{key:'a'.repeat(64),receivedAt:'2026-11-18T22:36:42Z',freshness:'fresh'}}
test('a reviewed sample expires independently of fresh heartbeats and invalidates on server/error evidence',()=>{
 assert.equal(muestraTramaVigente(snapshot,now),true)
 for(const bad of [{...snapshot,validation:{canRegister:false}},{...snapshot,privatePosition:false},{...snapshot,sample:{...snapshot.sample,receivedAt:'2026-11-18T20:00:00Z'}},{...snapshot,sample:{...snapshot.sample,receivedAt:'2026-11-19T22:00:00Z'}},{...snapshot,sample:{...snapshot.sample,key:'invalid'}},null])assert.equal(muestraTramaVigente(bad,now),false)
})
test('device wall clock is displayed without browser timezone conversion, GPS clock and valid zero coordinates remain explicit',()=>{
 assert.equal(fechaHoraEquipo({day:18,month:11,year:2026,hour:22,minute:36,second:41}),'18/11/2026 22:36:41')
 assert.equal(horaGps({hour:0,minute:0,second:0}),'00:00:00')
 assert.equal(ubicacionTrama({valid:true,latitude:0,longitude:0}),'0.000000, 0.000000')
 assert.equal(ubicacionTrama({valid:false,latitude:12,longitude:-71}),'Sin ubicación válida')
 assert.match(motivoRevision('no_position_frame'),/comunicación sola/)
 assert.match(motivoRevision('device_datetime_outside_timezone_window'),/reloj/)
})
test('private frame review sends identity only in POST body and uses server-scoped registered GET',async()=>{
 const calls=[],api=apiAutodeteccion(async(path,options)=>{calls.push({path,options});return snapshot})
 await api.revisar({imei:'123456789012345',transport:'tcp'})
 assert.equal(calls[0].path,'/api/v1/console/gps-discovery/review')
 assert.deepEqual(calls[0].options.cuerpo,{imei:'123456789012345',transport:'tcp'});assert.equal(calls[0].options.empresaContexto,null)
 await api.revisar({id});assert.equal(calls[1].path,`/api/v1/console/gps-devices/${id}/frame-review`)
 assert.equal(calls[1].options.cuerpo,undefined)
 assert.throws(()=>api.revisar({id:'invented'}),/inválido/)
})
