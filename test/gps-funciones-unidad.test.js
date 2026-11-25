import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

test('la ficha muestra sólo funciones elegidas del montaje vigente y conserva cero y apagado', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const [bundle] = await build({
    root, logLevel: 'error', build: {
      write: false,
      lib: { entry: 'src/panel/datos/funcionesInstalacion.js', formats: ['es'], fileName: 'funciones' },
    },
  })
  const source = bundle.output.find(item => item.type === 'chunk' && item.isEntry).code
  const { filasFuncionesGps } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
  const receivedAt = '2026-11-25T14:00:00.000Z'
  const fn = (semanticKey, functionId, extra) => ({
    semanticKey, functionId, instance: 1, installationVersion: 2, selected: true, direction: 'observation', ...extra,
  })
  const reading = (valueKind, values) => ({ valueKind, receivedAt, quality: 'valid', ...values })
  const snapshot = { assignmentId: 'montaje', isCurrent: true, installationVersion: 2, items: [
    fn('battery.level', '2-1', { unit: 'percent', lastObservation: reading('numeric', { numericValue: 0 }) }),
    fn('door.open', '2-2', { lastObservation: reading('boolean', { booleanValue: false }) }),
    fn('engine.rpm', '2-3', { lastObservation: null }),
    fn('ignition.acc', '2-4', { freshness: 'unknown', lastObservation: reading('boolean', { booleanValue: true, quality: 'contradictory' }) }),
    fn('fuel.level', '2-5', { selected: false }),
    fn('relay.cut', '2-6', { direction: 'command' }),
    fn('input.voltage', '1-1', { installationVersion: 1 }),
  ] }
  const rows = filasFuncionesGps('montaje', snapshot)
  assert.deepEqual(rows.map(({ etiqueta, valor }) => [etiqueta, valor]), [
    ['Batería', '0%'], ['Puerta', 'Cerrada'], ['Régimen del motor (RPM)', 'Sin lectura'], ['Contacto (ACC)', 'Lectura contradictoria'],
  ])
  assert.equal(rows[3].vigencia, 'Vigencia sin confirmar')
  assert.deepEqual(filasFuncionesGps('otro montaje', snapshot), [])
  assert.deepEqual(filasFuncionesGps('montaje', { ...snapshot, isCurrent: false }), [])
})
