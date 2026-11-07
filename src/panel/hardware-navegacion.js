import { areaDe, esAdminFom, esGestor } from './roles.js'

// Agrupar no concede acceso: conservar la intersección de área y rol existente.
export function menuHardware(perfil) {
  if (esAdminFom(perfil)) return {
    grupo: 'Hardware y telemetría', items: [
      { a: '/panel/admin/gps', icono: 'pin', texto: 'Equipos GPS', fin: true },
      { a: '/panel/admin/hardware/pruebas', icono: 'check', texto: 'Pruebas y diagnósticos' },
      { a: '/panel/admin/funciones', icono: 'pin', texto: 'Variables y funciones' },
      { a: '/panel/admin/hardware/perfiles', icono: 'llave', texto: 'Marcas y perfiles' },
    ],
  }
  if (areaDe(perfil) === 'operativo' && esGestor(perfil)) return {
    grupo: 'Hardware y telemetría', items: [
      { a: '/panel/funciones', icono: 'pin', texto: 'Variables y funciones' },
    ],
  }
  return null
}

export function reorganizarMenu(menu, perfil) {
  const hardware = menuHardware(perfil)
  const etiquetas = { a: esAdminFom(perfil) ? '/panel/admin/etiquetas' : '/panel/etiquetas', icono: 'pin', texto: 'Etiquetas', soloGestor: true }
  const result = menu.map(g => ({ ...g, items: g.items.filter(i =>
    !['/panel/funciones', '/panel/admin/funciones', '/panel/admin/gps'].includes(i.a)
    && (!i.soloGestor || esGestor(perfil))) }))
  if (hardware) {
    const flota = result.find(g => g.grupo === 'Flota')
    if (flota) flota.items.push(etiquetas)
    else result.unshift({ grupo: 'Flota', items: [etiquetas] })
    const index = result.findIndex(g => ['Usuarios', 'Análisis', 'Administración FOM'].includes(g.grupo))
    result.splice(index < 0 ? result.length : index, 0, hardware)
  }
  return result.filter(g => g.items.length)
}

export const PESTANAS_EQUIPO = ['diagnostico', 'datos', 'funciones', 'comandos', 'historial']
export function pestanaEquipo(search) {
  const value = new URLSearchParams(search).get('vista')
  return PESTANAS_EQUIPO.includes(value) ? value : 'diagnostico'
}
