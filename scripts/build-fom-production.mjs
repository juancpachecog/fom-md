import { build, loadEnv } from 'vite'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { revisar } from './bajar-modelo.mjs'
import { validReceiverIp } from '../src/panel/datos/gpsReceiver.js'
import { execFileSync } from 'node:child_process'

export function productionProfile(env) {
  if (env.VITE_FOM_API !== '/fom-api') throw Error('La publicación FOM requiere la API real del mismo origen; modo demostración rechazado.')
  if (!/^pk\.[A-Za-z0-9_.-]+$/.test(env.VITE_MAPBOX_TOKEN || '')) throw Error('La publicación FOM requiere el perfil de mapas configurado.')
  if (!validReceiverIp(env.VITE_GPS_RECEPTOR)) throw Error('La publicación FOM requiere la IP del receptor GPS configurada.')
  const keys = ['VITE_FOM_API', 'VITE_MAPBOX_TOKEN', 'VITE_MAPA_ESTILO', 'VITE_MAPA_ATRIBUCION', 'VITE_CLOUDINARY_CLOUD_NAME', 'VITE_CLOUDINARY_UPLOAD_PRESET', 'VITE_GPS_RECEPTOR']
  const values = Object.fromEntries(keys.map(k => [k, env[k] || '']))
  return { version: 1, application: 'fom-panel', mode: 'connected', apiBase: '/fom-api', mapboxConfigured: true, gpsReceiverConfigured: true,
    publicConfigSha256: createHash('sha256').update(JSON.stringify(values)).digest('hex') }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const envDir = resolve(process.argv[2] || '.')
  const profile = productionProfile(loadEnv('production', envDir, 'VITE_'))
  const problems = await revisar()
  if (problems.length) throw Error(problems.join('; '))
  execFileSync(process.execPath, ['--test', ...[
    'gps-panel', 'gps-discovery', 'gps-inventory', 'gps-meitrack', 'meitrack-wizard',
    'meitrack-operational', 'meitrack-guided', 'meitrack-clock-readback', 'production-profile',
    'coban-identification',
  ].map(name => `test/${name}.test.js`)], { stdio: 'inherit' })
  await build({ mode: 'production', envDir, plugins: [{ name: 'fom-connected-build-witness',
    configResolved(config) {
      if (productionProfile(config.env).publicConfigSha256 !== profile.publicConfigSha256)
        throw Error('El perfil efectivo de Vite no coincide con el perfil revisado.')
    },
    closeBundle() { writeFileSync(resolve('dist/fom-build-profile.json'), JSON.stringify({ ...profile, gpsFlowVerified: true })) } }] })
  console.log('FOM_PRODUCTION_CONNECTED_PROFILE=PASS')
}
