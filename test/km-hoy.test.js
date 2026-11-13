import test from 'node:test'
import assert from 'node:assert/strict'
import { leerKmHoy, lecturaKmSeleccionado, metricaDeHoy } from '../src/panel/datos/kmHoy.js'

test('al cambiar de vehículo nunca se muestran los kilómetros de la selección anterior',()=>{
  const carga={estado:'ok',datos:{vehiculoId:'A',metrica:{km:100}}}
  assert.deepEqual(lecturaKmSeleccionado(carga,'B'),{estado:'cargando',metrica:null})
  assert.equal(lecturaKmSeleccionado(carga,'A').metrica.km,100)
  assert.deepEqual(lecturaKmSeleccionado({...carga,estado:'error'},'B'),{estado:'error',metrica:null})
})

const now = Date.parse('2026-11-14T04:30:00Z') // Caracas14; Nueva York13.
const row = { metricDate:'2026-11-13', timezoneName:'America/New_York', distanceMeters:'12345', calculationStatus:'partial', computedAt:'2026-11-14T04:29:00Z' }
test('hoy sigue la zona del acumulado y conserva su condición parcial', () => {
  const m = metricaDeHoy([row],now)
  assert.equal(m.km,12.345);assert.equal(m.parcial,true);assert.equal(m.fecha,'2026-11-13');assert.equal(m.zona,row.timezoneName)
  assert.equal(metricaDeHoy([{...row,timezoneName:'America/Caracas'}],now),null)
})
test('ausente, inválido o ambiguo no se convierten en cero; cero publicado sí se conserva', () => {
  assert.equal(metricaDeHoy([],now),null)
  for(const distanceMeters of [null,undefined,'',' ',true,false,-1,'bad',Infinity])assert.equal(metricaDeHoy([{...row,distanceMeters}],now),null)
  assert.equal(metricaDeHoy([row,row],now),null)
  assert.equal(metricaDeHoy([{...row,timezoneName:'zona-inválida'}],now),null)
  const m=metricaDeHoy([{...row,distanceMeters:0,calculationStatus:'complete'}],now)
  assert.equal(m.km,0);assert.equal(m.parcial,false)
})
test('lectura diaria pide rango acotado de tres fechas y propaga errores', async()=>{
  const m=await leerKmHoy(async(id,from,to)=>{assert.equal(id,'vehicle-test');assert.equal(from,'2026-11-13');assert.equal(to,'2026-11-15');return {items:[row]}},'vehicle-test',now)
  assert.equal(m.km,12.345)
  await assert.rejects(()=>leerKmHoy(async()=>{throw Error('offline')},'vehicle-test',now),/offline/)
})
