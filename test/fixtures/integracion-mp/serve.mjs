import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Sin configuración ni .env del sitio, proxy, API nominal o credenciales.
const root = fileURLToPath(new URL('../../../', import.meta.url))
const server = await createServer({ root, configFile: false, envFile: false, envDir: false,
  plugins: [react()], define: { 'import.meta.env.VITE_FOM_API': '""' },
  server: { host: '127.0.0.1', port: 5205, strictPort: true },
})
await server.listen()
console.log('SYNTHETIC ONLY http://127.0.0.1:5205/test/fixtures/integracion-mp/index.html')
