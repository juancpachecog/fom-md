// Puente de prueba para la app de Juan en su versión web: el navegador no puede
// llamar directo al servidor de FOM (sin CORS y con certificado propio), así que
// este proceso local recibe las llamadas en http://localhost:8098 y las reenvía
// tal cual al servidor que dice el .env.local de la app. No guarda nada.
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'

const env = fs.readFileSync('C:/Users/home/Downloads/fom-driver-juan/.env.local', 'utf8')
const destino = new URL(env.match(/^EXPO_PUBLIC_FOM_API_URL=(.+)$/m)[1].trim())
const PUERTO = 8098

const cors = (origen) => ({
  'access-control-allow-origin': origen || '*',
  'access-control-allow-credentials': 'true',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,idempotency-key,x-requested-with,accept,x-fom-client',
  'access-control-max-age': '600',
})

http.createServer((req, res) => {
  const origen = req.headers.origin
  if (req.method === 'OPTIONS') { res.writeHead(204, cors(origen)); res.end(); return }
  const cabeceras = { ...req.headers, host: destino.host }
  delete cabeceras.origin
  delete cabeceras.referer
  const salida = https.request({
    hostname: destino.hostname, port: destino.port || 443, path: req.url, method: req.method,
    headers: cabeceras, rejectUnauthorized: false,
  }, (r) => {
    const h = { ...r.headers, ...cors(origen) }
    delete h['set-cookie']
    res.writeHead(r.statusCode || 502, h)
    r.pipe(res)
  })
  salida.on('error', (e) => { res.writeHead(502, cors(origen)); res.end(JSON.stringify({ message: `Puente: ${e.message}` })) })
  req.pipe(salida)
}).listen(PUERTO, () => console.log(`Puente de la app escuchando en http://localhost:${PUERTO}`))
