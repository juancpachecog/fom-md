import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'vite'
import react from '@vitejs/plugin-react'
const bundle=await build({configFile:false,envFile:false,plugins:[react()],logLevel:'silent',ssr:{noExternal:true},
 build:{ssr:'test/fixtures/guia-funciones-entry.jsx',write:false,minify:false}})
const code=bundle.output.find(x=>x.type==='chunk'&&x.isEntry).code
const {pasosGuiaFunciones,renderGuia}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

test('guía compilada conserva navegación accesible sin formularios ni controles de certificación',()=>{
 const html=renderGuia('meitrack-t399')
 assert.match(html,/aria-label="Pasos de la guía de funciones"/)
 assert.match(html,/aria-current="step"/)
 assert.match(html,/aria-label="Paso 1 de 6"/)
 assert.match(html,/Paso anterior/);assert.match(html,/Paso siguiente/)
 assert.doesNotMatch(html,/<form|type="submit"|type="checkbox"/)
 assert.match(html,/no guarda configuración/)
})
test('puerta y ACC exigen secuencia de ida y vuelta; no convertir recorrido de ayuda en PASS',()=>{
 for(const family of ['meitrack-t399','coban-gps103','unknown']){
  const text=pasosGuiaFunciones(family).flatMap(s=>s.text).join('\n')
  assert.match(text,/cerrada → abierta → cerrada/)
  assert.match(text,/sin contacto → contacto activo → sin contacto/)
  assert.match(text,/muestras elegibles nuevas/)
  assert.match(text,/recorrer esta guía no registra PASS/)
  assert.match(text,/Activación eléctrica negativa NO significa elegir Invertida/)
  assert.match(text,/reconstruye y revisa también las funciones/)
 }
})
test('guías por familia no inventan firmware ni convierten referencia de color en conexión universal',()=>{
 const meitrack=pasosGuiaFunciones('meitrack-t399')[1].text.join(' ')
 assert.match(meitrack,/pin 3\/gris/);assert.match(meitrack,/pin 4\/blanco/)
 assert.match(meitrack,/modos se pueden cambiar/)
 const coban=pasosGuiaFunciones('coban-gps103')[1].text.join(' ')
 assert.match(coban,/firmware desconocido/);assert.match(coban,/versión de la app/)
 assert.match(coban,/No hay un SMS universal revisado/)
 assert.doesNotMatch(coban,/123456|version\d|check\d/)
 assert.match(pasosGuiaFunciones('unknown')[1].text.join(' '),/no tiene una guía de cableado específica/)
 assert.doesNotMatch(renderGuia('unknown'),/href=/)
})
