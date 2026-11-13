// Presentación de la sesión existente; no elige tenant ni cambia permisos.
export function empresaActiva(perfil, admin = false) {
  const texto = valor => typeof valor === 'string' ? valor.trim() : ''
  if (perfil?.empresaGestion) return texto(perfil.empresaGestion.nombre) || 'Empresa seleccionada'
  if (admin) return 'Sin empresa seleccionada · Administración global'
  return texto(perfil?.empresa) || 'Empresa no disponible'
}
