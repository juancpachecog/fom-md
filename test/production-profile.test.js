import { test } from 'node:test'
import assert from 'node:assert/strict'
import { productionProfile } from '../scripts/build-fom-production.mjs'

test('production rejects missing API, alternate origin and missing map configuration', () => {
  for (const VITE_FOM_API of [undefined, '', 'https://other.invalid/fom-api', '/demo'])
    assert.throws(() => productionProfile({ VITE_FOM_API, VITE_MAPBOX_TOKEN: 'pk.synthetic' }), /API real/)
  assert.throws(() => productionProfile({ VITE_FOM_API: '/fom-api' }), /mapas/)
})
test('connected build witness preserves configuration identity without publishing token values', () => {
  const env = { VITE_FOM_API: '/fom-api', VITE_MAPBOX_TOKEN: 'pk.synthetic', VITE_GPS_RECEPTOR: '192.0.2.24' }
  const profile = productionProfile(env)
  assert.equal(profile.mode, 'connected')
  assert.equal(profile.apiBase, '/fom-api')
  assert.equal(profile.mapboxConfigured, true)
  assert.equal(profile.gpsReceiverConfigured, true)
  for (const VITE_GPS_RECEPTOR of [undefined, '', '[IP del receptor]', '999.1.1.1'])
    assert.throws(() => productionProfile({ ...env, VITE_GPS_RECEPTOR }), /receptor GPS/)
  assert.notEqual(productionProfile({ ...env, VITE_GPS_RECEPTOR: '192.0.2.25' }).publicConfigSha256, profile.publicConfigSha256)
  assert.ok(!JSON.stringify(profile).includes('pk.synthetic'))
  assert.notEqual(productionProfile({ ...env, VITE_MAPA_ESTILO: 'changed' }).publicConfigSha256, profile.publicConfigSha256)
})
