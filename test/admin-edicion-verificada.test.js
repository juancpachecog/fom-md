import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { build } from 'vite'
import { cambiosDatosUsuario } from '../src/panel/datos/perfilUsuario.js'

let modulo
async function cargar() {
  if (!modulo) modulo = (async () => {
    const root = join(import.meta.dirname, '..')
    const salida = await build({ root, logLevel: 'error', define: { 'import.meta.env.VITE_FOM_API': JSON.stringify('http://servidor-falso.invalid') },
      plugins: [{ name: 'edicion-835', resolveId: id => id.endsWith('virtual:835') ? '\0edicion835' : null,
        load: id => id === '\0edicion835' ? `export { repoApi } from ${JSON.stringify(join(root, 'src/panel/datos/repoApi.js'))}; export { api } from ${JSON.stringify(join(root, 'src/panel/datos/api.js'))}` : null }],
      build: { write: false, minify: false, lib: { entry: 'virtual:835', formats: ['es'], fileName: 'edicion835' } } })
    return import('data:text/javascript;base64,' + Buffer.from(salida[0].output[0].code).toString('base64'))
  })()
  return modulo
}
function reemplazar(t, obj, key, value) { const previo = obj[key]; obj[key] = value; t.after(() => { obj[key] = previo }) }

test('edición de vehículo omite datos ajenos y permite quitar VIN y año sin convertirlos en cero', async t => {
  const { repoApi, api } = await cargar()
  let guardado
  reemplazar(t, api, 'actualizarVehiculo', async (id, body) => { guardado = { id, body: JSON.parse(JSON.stringify(body)) } })
  await repoApi.vehiculosEscritura.set('vehicle-835', { codigo: 'unit-835', vin: '', anio: '', tenantId: 'intruso', estado: 'archived' })
  assert.deepEqual(guardado, { id: 'vehicle-835', body: { code: 'unit-835', vin: null, modelYear: null } })
  await repoApi.vehiculosEscritura.set('vehicle-835', { placa: '', alias: '', marca: '', modelo: '' })
  assert.deepEqual(guardado.body, { plate: null, alias: null, make: null, model: null })
})
test('empresa exige lectura posterior coincidente, permite quitar contacto y no repite una escritura incierta', async t => {
  const { repoApi, api } = await cargar()
  let escrituras = 0, lecturas = 0, body
  reemplazar(t, api, 'actualizarEnte', async (_id, b) => { escrituras++; body = b })
  reemplazar(t, repoApi.empresas, 'listar', async () => { lecturas++; return [{ id: '835', nombre: 'Anterior', rif: '', contacto: '', telefono: '', email: '' }] })
  await assert.rejects(repoApi.empresas.set('835', { nombre: 'Nueva', rif: '', contacto: '', telefono: '', email: '' }), /comprobar/)
  assert.equal(escrituras, 1); assert.equal(lecturas, 1)
  assert.deepEqual(body, { name: 'Nueva', rif: null, contactName: null, phone: null, email: null })
})
test('perfil no presenta éxito solo por recibir respuesta del PATCH', async t => {
  const { repoApi, api } = await cargar()
  let escrituras = 0, lecturas = 0
  reemplazar(t, api, 'actualizarPerfil', async () => { escrituras++; return { profile: {} } })
  reemplazar(t, repoApi.gente, 'listar', async () => { lecturas++; return [{ userId: '835', nombre: 'Anterior' }] })
  await assert.rejects(repoApi.gente.actualizarPerfil('835', { nombre: 'Nombre nuevo' }), /comprobada/)
  assert.equal(escrituras, 1); assert.equal(lecturas, 1)
})
test('nombre de usuario editable sin vaciar los datos que no se leyeron', () => {
  assert.deepEqual(cambiosDatosUsuario({ nombre: ' Nombre nuevo ' }, { nombre: 'Anterior' }), { nombre: 'Nombre nuevo' })
  assert.throws(() => cambiosDatosUsuario({ nombre: ' ' }, { nombre: 'Anterior' }), /nombre/)
})
