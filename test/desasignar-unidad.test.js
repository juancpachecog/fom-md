import { test } from 'node:test'
import assert from 'node:assert/strict'
import { desasignarUnidad } from '../src/panel/datos/desasignarUnidad.js'

function escenario(tipo = 'gps') {
  let estado = { gps: [{ id: 'instalacion' }], conductores: [{ id: 'principal' }, { id: 'secundario' }] }
  const llamadas = []
  return { llamadas, relacion: { tipo, id: tipo === 'gps' ? 'instalacion' : 'secundario' }, acciones: {
    async leer(id) { llamadas.push(['leer', id]); return structuredClone(estado) },
    async quitarGps(id, motivo) { llamadas.push(['gps', id, motivo]); estado.gps = estado.gps.filter(x => x.id !== id) },
    async quitarConductor(id, motivo) { llamadas.push(['conductor', id, motivo]); estado.conductores = estado.conductores.filter(x => x.id !== id) },
  } }
}
test('termina solo la instalación elegida y comprueba otra lectura; conserva usuarios', async () => {
  const f = escenario(); const r = await desasignarUnidad('unidad', f.relacion, ' prueba ', f.acciones)
  assert.deepEqual(f.llamadas, [['leer', 'unidad'], ['gps', 'instalacion', 'prueba'], ['leer', 'unidad']])
  assert.equal(r.gps.length, 0); assert.equal(r.conductores.length, 2)
})
test('permite retirar un secundario sin afectar principal ni GPS', async () => {
  const f = escenario('conductor'); const r = await desasignarUnidad('unidad', f.relacion, 'Fin', f.acciones)
  assert.deepEqual(r.conductores, [{ id: 'principal' }]); assert.equal(r.gps.length, 1)
})
test('rechaza relación obsoleta o motivo vacío sin efectos', async () => {
  const f = escenario(); await assert.rejects(desasignarUnidad('unidad', { tipo: 'gps', id: 'otra' }, 'Fin', f.acciones), /cambió/)
  await assert.rejects(desasignarUnidad('unidad', f.relacion, '', f.acciones))
  assert.deepEqual(f.llamadas, [['leer', 'unidad']])
})
test('un resultado incierto no se reintenta y una lectura que aún muestra la relación no se presenta como éxito', async () => {
  const f = escenario(); f.acciones.quitarGps = async () => { f.llamadas.push(['una_mutacion']); throw Error('Respuesta perdida') }
  await assert.rejects(desasignarUnidad('unidad', f.relacion, 'Fin', f.acciones), /perdida/)
  assert.equal(f.llamadas.filter(x => x[0] === 'una_mutacion').length, 1)
  f.acciones.quitarGps = async () => {}
  await assert.rejects(desasignarUnidad('unidad', f.relacion, 'Fin', f.acciones), /no quedó comprobada/)
})
