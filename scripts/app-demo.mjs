// La app de Juan en MODO DEMOSTRACIÓN (sin servidor, datos de ejemplo), versión
// web, para comparar pantallas con el panel. No lee el .env.local entero —así
// no se conecta a producción—: solo toma de ahí el token público de Mapbox.
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const APP = 'C:/Users/home/Downloads/fom-driver-juan'
const env = { ...process.env, CI: '1', EXPO_NO_DOTENV: '1' }
delete env.EXPO_PUBLIC_FOM_API_URL
try {
  const local = fs.readFileSync(`${APP}/.env.local`, 'utf8')
  const token = local.match(/^EXPO_PUBLIC_MAPBOX_TOKEN=(pk\.\S+)$/m)?.[1]
  if (token) env.EXPO_PUBLIC_MAPBOX_TOKEN = token
} catch { /* sin token: mapa de siempre */ }

const hijo = spawn('npx', ['expo', 'start', '--web', '--port', '8097'], { cwd: APP, env, stdio: 'inherit', shell: true })
hijo.on('exit', (c) => process.exit(c ?? 0))
