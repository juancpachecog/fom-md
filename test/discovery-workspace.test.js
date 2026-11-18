import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paginaDescubrimiento, permiteRegistrarVisto } from '../src/panel/datos/paginaDescubrimiento.js'
const lista = Array.from({ length: 12 }, (_,i) => ({ imei: String(900000000000000 + i), transporte: i % 2 ? 'udp' : 'tcp' }))
test('permite recorrer varios candidatos sin filas perdidas y acota páginas al cambiar la muestra', () => {
  const filas = [0,1,2].flatMap(p => paginaDescubrimiento(lista, '', p).filas)
  assert.deepEqual(filas, lista)
  assert.equal(paginaDescubrimiento(lista.slice(0,2), '', 2).pagina, 0)
})
test('búsqueda por identidad o transporte mantiene la identidad de cada candidato', () => {
  assert.deepEqual(paginaDescubrimiento(lista, '000000000011').filas, [lista[11]])
  assert.equal(paginaDescubrimiento(lista, ' UDP ').total, 6)
  assert.equal(paginaDescubrimiento(lista, 'ausente').total, 0)
})
test('ver otro dispositivo no permite registrar la selección anterior; errores y mutaciones bloquean el registro', () => {
  const base = { guardando:false, estado:'ok', visto:'gps-a', seleccionado:'gps-a', puedeRegistrar:true }
  assert.equal(permiteRegistrarVisto(base), true)
  for (const cambio of [{visto:'gps-b'}, {visto:null}, {estado:'error'}, {guardando:true}, {puedeRegistrar:false}]) assert.equal(permiteRegistrarVisto({...base,...cambio}), false)
})
