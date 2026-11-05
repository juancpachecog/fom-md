import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../../', import.meta.url))
const server = await createServer({ root, configFile: false, envFile: false, envDir: false,
  plugins: [react()], define: { 'import.meta.env.VITE_FOM_API': '"/fixture-api"' },
  server: { host: '127.0.0.1', port: 5206, strictPort: true } })
await server.listen()
console.log('SYNTHETIC ONLY http://127.0.0.1:5206/test/fixtures/ciclo-datos/index.html')
