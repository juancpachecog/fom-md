// ============================================================
// VEHÍCULOS DE TODAS LAS EMPRESAS (Administrador FOM)
// ------------------------------------------------------------
// El servidor no tiene todavía una lista de vehículos de toda la
// plataforma. El administrador FOM sí puede leer los de cada empresa por su
// ruta propia (`/tenants/{id}/vehicles`, la misma que usa Transferencias),
// así que aquí se recorren las empresas una por una, con su paginación, y
// se juntan. Si una empresa falla se dice cuál, sin tumbar las demás.
// ============================================================
import { HAY_API, api, pedir } from './api'
import repo from './repo'
import { leerTodasLasPaginas } from './listar-odts'
import { conRecepcionEquipo } from './recepcionUnidad.js'
import { leerRecepcionGps } from './leerRecepcionGps.js'

const CONSOLA = '/api/v1/console'

function comoFila(v, empresa) {
  return {
    id: v.id,
    empresaId: empresa.id,
    empresaNombre: empresa.nombre,
    empresa,
    alias: v.alias || v.fleetNumber || v.code || 'Sin nombre',
    placa: v.plate || '',
    numero: v.fleetNumber || v.code || '',
    marca: v.make || '',
    modelo: v.model || '',
    anio: v.modelYear ?? null,
    tipo: v.vehicleType || 'otro',
    estado: v.status || null,
    areaNombre: v.areaName ?? null,
    velocidadKmh: v.speedKph ?? null,
    km: v.odometerKm ?? null,
    ultimoReporte: v.lastReportAt ?? null,
    lat: v.latitude ?? null,
    lng: v.longitude ?? null,
    conductorNombre: null,
  }
}

async function vehiculosDeEmpresa(empresa) {
  // Todas las páginas: la primera dice el total y las demás se piden a la vez.
  const r = await leerTodasLasPaginas((desplazamiento, limite) => api.vehiculos({ enteId: empresa.id, limite, desplazamiento }))
  const lista = r.items.map((v) => comoFila(v, empresa))
  // El conductor principal no es imprescindible: si su lectura falla, la unidad sale igual.
  // También todas las páginas: con más de 200 asignaciones, las últimas unidades salían sin conductor.
  try {
    const asignaciones = await leerTodasLasPaginas(
      (desplazamiento, limite) => pedir(`${CONSOLA}/tenants/${empresa.id}/drivers?limit=${limite}&offset=${desplazamiento}`),
      { clave: (c) => c?.assignmentId },
    )
    const porVehiculo = new Map()
    for (const c of asignaciones.items) {
      if (!c.vehicleId) continue
      if (c.role === 'principal' || !porVehiculo.has(c.vehicleId)) porVehiculo.set(c.vehicleId, c.displayName)
    }
    for (const v of lista) v.conductorNombre = porVehiculo.get(v.id) ?? null
  } catch { /* sin conductores */ }
  return lista
}

/** Todas las unidades de todas las empresas, más la lista de empresas que no se pudieron leer. */
export async function vehiculosDeLaPlataforma() {
  const empresas = await repo.admin.empresas.listar({})
  if (!HAY_API) {
    // Modo demostración: una sola empresa, con la flota de siempre.
    const empresa = empresas[0] ?? { id: 'demo', nombre: 'Empresa demo' }
    const vs = await repo.vehiculos.listar({})
    return {
      empresas,
      fallidas: [],
      vehiculos: vs.map((v) => ({
        ...comoFila({ id: v.id, alias: v.alias, plate: v.placa, fleetNumber: v.numero, make: v.marca, model: v.modelo, modelYear: v.anio, vehicleType: v.tipo, status: v.estado, areaName: v.areaNombre, speedKph: v.velocidadKmh, odometerKm: v.km, lastReportAt: v.ultimoReporte, latitude: v.lat, longitude: v.lng }, empresa),
        conductorNombre: v.conductorNombre && v.conductorNombre !== 'Sin asignar' ? v.conductorNombre : null,
      })),
    }
  }
  const resultados = await Promise.allSettled(empresas.map(vehiculosDeEmpresa))
  const vehiculos = []
  const fallidas = []
  resultados.forEach((r, i) => {
    if (r.status === 'fulfilled') vehiculos.push(...r.value)
    else fallidas.push({ empresa: empresas[i], error: r.reason?.message || 'No se pudo leer.' })
  })
  const equipos = await leerRecepcionGps(() => api.equiposGps(), { opcional: false })
  for (let i = 0; i < vehiculos.length; i++) {
    const candidatos = equipos.filter(g => g.vehicleId === vehiculos[i].id)
    if (candidatos.length === 1) vehiculos[i] = conRecepcionEquipo(vehiculos[i], candidatos[0])
  }
  vehiculos.sort((a, b) => a.empresaNombre.localeCompare(b.empresaNombre) || a.alias.localeCompare(b.alias))
  return { empresas, fallidas, vehiculos }
}
