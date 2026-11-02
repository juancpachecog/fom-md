// ============================================================
// CATÁLOGOS — espejo exacto de los enums de la base de datos real
// (supabase/migrations/0001_esquema.sql de la app móvil).
// Los valores NO se inventan: si mañana el panel se conecta a Supabase,
// estos mismos strings viajan sin traducción.
// ============================================================

export const VEHICULO_TIPO = ['camioneta', 'camion', 'auto', 'otro']
export const MARCHA_ESTADO = ['en_marcha', 'parada']
export const AREA_TIPO = ['ubicacion', 'sector', 'contrato']
export const ODT_ESTADO = ['abierta', 'en_revision', 'cerrada']
export const ODT_TIPO = ['correctiva', 'preventiva']
export const INSPECCION_ITEM_ESTADO = ['conforme', 'observacion', 'falla']
export const INSPECCION_RESULTADO = ['pendiente', 'aprobada', 'aprobada_con_observaciones', 'bloqueada']
export const REGLA_TIPO = ['velocidad', 'mantenimiento']
export const DOCUMENTO_AMBITO = ['vehiculo', 'persona']
export const ALERTA_SEVERIDAD = ['info', 'advertencia', 'critica']
export const ALERTA_CATEGORIA = ['seguridad', 'mantenimiento', 'documento', 'otro']
export const TIPO_FALLA = ['motor', 'frenos', 'neumaticos', 'electrico', 'carroceria', 'otro']

// --- Etiquetas visibles (español de la app) --------------------------------
export const ETIQUETA = {
  vehiculo_tipo: {
    camioneta: 'Camioneta',
    camion: 'Camión',
    auto: 'Automóvil',
    otro: 'Otro',
  },
  marcha_estado: {
    en_marcha: 'En marcha',
    parada: 'Detenida',
  },
  // Estado de CONEXIÓN del equipo, que no es lo mismo que el de marcha. La
  // base guarda cuándo reportó por última vez, pero no la velocidad, así que
  // de una unidad que reporta no se sabe si va rodando o está estacionada.
  conexion: {
    reportando: 'Reportando',
    sin_senal: 'Sin señal',
  },
  area_tipo: {
    ubicacion: 'Ubicación',
    sector: 'Sector',
    contrato: 'Contrato',
  },
  odt_estado: {
    abierta: 'Abierta',
    en_revision: 'En revisión',
    aprobada: 'Aprobada',
    asignada: 'Asignada',
    en_ejecucion: 'En ejecución',
    pausada: 'Pausada',
    en_calidad: 'En calidad',
    cerrada: 'Cerrada',
    cancelada: 'Cancelada',
  },
  odt_prioridad: { baja: 'Baja', media: 'Media', alta: 'Alta' },
  odt_tipo: {
    correctiva: 'Correctiva',
    preventiva: 'Preventiva',
  },
  inspeccion_item_estado: {
    conforme: 'Conforme',
    observacion: 'Observación',
    falla: 'Falla',
  },
  inspeccion_resultado: {
    pendiente: 'Pendiente',
    aprobada: 'Aprobada',
    aprobada_con_observaciones: 'Aprobada con observaciones',
    bloqueada: 'Bloqueada',
  },
  regla_tipo: {
    velocidad: 'Velocidad',
    mantenimiento: 'Mantenimiento',
  },
  alerta_severidad: {
    info: 'Informativa',
    advertencia: 'Advertencia',
    critica: 'Crítica',
  },
  alerta_categoria: {
    seguridad: 'Seguridad',
    mantenimiento: 'Mantenimiento',
    documento: 'Documento',
    otro: 'Otro',
  },
  tipo_falla: {
    motor: 'Motor',
    frenos: 'Frenos',
    neumaticos: 'Neumáticos',
    electrico: 'Eléctrico',
    carroceria: 'Carrocería',
    otro: 'Otro',
  },
  documento_estado: {
    vigente: 'Vigente',
    por_vencer: 'Por vencer',
    vencido: 'Vencido',
  },
  rol: {
    admin: 'Administrador FOM',
    supervisor_company: 'Administrador',
    conductor: 'Conductor',
    supervisor_personal: 'Supervisor',
    usuario_personal: 'Usuario',
  },
}

/** Color del tag según el estado. Devuelve la clase de .pnl-tag */
export const COLOR = {
  marcha_estado: { en_marcha: 'verde', parada: 'gris' },
  conexion: { reportando: 'verde', sin_senal: 'gris' },
  odt_estado: {
    abierta: 'ambar',
    en_revision: 'azul',
    aprobada: 'azul',
    asignada: 'azul',
    en_ejecucion: 'azul',
    pausada: 'ambar',
    en_calidad: 'azul',
    cerrada: 'verde',
    cancelada: 'gris',
  },
  odt_prioridad: { baja: 'gris', media: 'azul', alta: 'rojo' },
  inspeccion_resultado: {
    pendiente: 'gris',
    aprobada: 'verde',
    aprobada_con_observaciones: 'ambar',
    bloqueada: 'rojo',
  },
  inspeccion_item_estado: { conforme: 'verde', observacion: 'ambar', falla: 'rojo' },
  alerta_severidad: { info: 'azul', advertencia: 'ambar', critica: 'rojo' },
  documento_estado: { vigente: 'verde', por_vencer: 'ambar', vencido: 'rojo' },
}

// ODT con 3 estados visibles (Abierta / En revisión / Resuelta), como la app.
// SOLO presentación: `odt_estado` sigue con los 9 del servidor porque Reportes
// los cuenta uno a uno. Mismos grupos que ESTADOS_VISIBLES de historial-odt.js
// (no se importa de allí: ese archivo ya importa este y quedaría en círculo).
const ODT_GRUPOS = [
  ['Abierta', 'ambar', ['abierta']],
  ['En revisión', 'azul', ['en_revision', 'aprobada', 'asignada', 'en_ejecucion', 'pausada', 'en_calidad']],
  ['Resuelta', 'verde', ['cerrada', 'cancelada']],
]
ETIQUETA.odt_estado_visible = Object.fromEntries(ODT_GRUPOS.flatMap(([et, , estados]) => estados.map(e => [e, et])))
COLOR.odt_estado_visible = Object.fromEntries(ODT_GRUPOS.flatMap(([, col, estados]) => estados.map(e => [e, col])))

/** Traduce un valor de enum a su etiqueta visible. */
export function etiqueta(enumName, valor) {
  return ETIQUETA[enumName]?.[valor] ?? valor ?? ''
}

/** Clase de color del tag para un valor de enum. */
export function color(enumName, valor) {
  return COLOR[enumName]?.[valor] ?? 'gris'
}

// --- Catálogo de ítems de inspección ---------------------------------------
// Mismas 15 filas que siembra 0002_seed.sql. `tipos: []` = aplica a todos.
export const ITEMS_INSPECCION = [
  { id: 'insp-llantas-1', categoria: 'Llantas', nombre: 'Presión y estado de neumáticos', critico: true, tipos: [] },
  { id: 'insp-llantas-2', categoria: 'Llantas', nombre: 'Profundidad de labrado', critico: false, tipos: [] },
  { id: 'insp-llantas-3', categoria: 'Llantas', nombre: 'Caucho de repuesto y gato', critico: false, tipos: [] },
  { id: 'insp-frenos-1', categoria: 'Frenos', nombre: 'Pedal y respuesta de frenos', critico: true, tipos: [] },
  { id: 'insp-frenos-2', categoria: 'Frenos', nombre: 'Freno de estacionamiento', critico: true, tipos: [] },
  { id: 'insp-luces-1', categoria: 'Luces', nombre: 'Luces delanteras y traseras', critico: true, tipos: [] },
  { id: 'insp-luces-2', categoria: 'Luces', nombre: 'Cruces y direccionales', critico: false, tipos: [] },
  { id: 'insp-motor-1', categoria: 'Motor y fluidos', nombre: 'Nivel de aceite de motor', critico: true, tipos: [] },
  { id: 'insp-motor-2', categoria: 'Motor y fluidos', nombre: 'Refrigerante y fugas visibles', critico: true, tipos: [] },
  { id: 'insp-motor-3', categoria: 'Motor y fluidos', nombre: 'Correas y mangueras', critico: false, tipos: [] },
  { id: 'insp-cabina-1', categoria: 'Cabina y seguridad', nombre: 'Cinturones de seguridad', critico: true, tipos: [] },
  { id: 'insp-cabina-2', categoria: 'Cabina y seguridad', nombre: 'Extintor vigente', critico: true, tipos: [] },
  { id: 'insp-cabina-3', categoria: 'Cabina y seguridad', nombre: 'Botiquín y triángulos', critico: false, tipos: [] },
  { id: 'insp-doc-1', categoria: 'Documentos', nombre: 'Documentos del vehículo a bordo', critico: false, tipos: [] },
  { id: 'insp-carga-1', categoria: 'Carga y acople', nombre: 'Amarres y quinta rueda', critico: true, tipos: ['camion'] },
]

// ============================================================
// REGLAS DEL ADMINISTRADOR FOM (permissions.ts + Edge Functions de la app)
// ============================================================

/** Tipos de ente, como company_tipo de la base. */
export const COMPANY_TIPO = ['estandar', 'predefinida', 'personal']
ETIQUETA.company_tipo = {
  estandar: 'Contratista',
  predefinida: 'Compañía',
  personal: 'Personal',
}
ETIQUETA.pago_estado = {
  pendiente: 'Pendiente',
  pagado: 'Pagado',
  vencido: 'Vencido',
}
COLOR.pago_estado = { pendiente: 'ambar', pagado: 'verde', vencido: 'rojo' }
COLOR.company_tipo = { estandar: 'azul', predefinida: 'gris', personal: 'verde' }

/** Ente de respaldo: aquí van las personas "eliminadas" (su cuenta no se borra). */
export const DESEMPLEADOS_ID = 'desempleados-ca'

/** Roles que se pueden asignar desde el panel. `admin` nunca se asigna. */
export const ROLES_ASIGNABLES = ['conductor', 'supervisor_company', 'supervisor_personal', 'usuario_personal']

/** Clave de mentira que el modo demo muestra al crear o restablecer una cuenta. No es de ninguna cuenta real. */
export const CLAVE_POR_DEFECTO = 'Demo-Solo-Ejemplo-1'

/** Jerarquía de mando: cada quien solo gestiona a los de rango MENOR, nunca a sí mismo. */
export const RANGO = {
  admin: 4,
  supervisor_company: 3,
  supervisor_personal: 3,
  conductor: 1,
  usuario_personal: 1,
  // La sesión de la demo usa los nombres de roles.js (admin_fom, supervisor), no los
  // de la semilla: sin estos dos, un supervisor quedaba con rango 1 y no podía con nadie.
  admin_fom: 4,
  supervisor: 3,
}
export function puedeGestionarA(actor, objetivo) {
  if (!actor || !objetivo || actor.id === objetivo.id) return false
  return (RANGO[objetivo.rol] ?? 1) < (RANGO[actor.rol] ?? 1)
}

/**
 * Compatibilidad rol - tipo de ente (validada tres veces en la app).
 * Devuelve el mensaje de error, o null si es válido.
 */
export function validarRolEmpresa(rol, tipoEmpresa) {
  if (rol === 'conductor' && tipoEmpresa === 'predefinida')
    return 'Una compañía no opera flota propia: su perfil es el Supervisor.'
  const esPersonal = rol === 'supervisor_personal' || rol === 'usuario_personal'
  if (esPersonal && tipoEmpresa !== 'personal')
    return 'Los perfiles personales solo existen en cuentas personales.'
  if (!esPersonal && tipoEmpresa === 'personal')
    return 'Una cuenta personal solo admite perfiles personales.'
  return null
}

/**
 * Etiqueta del rol según el tipo de ente, como etiquetaRol() de la app:
 * supervisor_company es "Supervisor" en una compañía y "Administrador" en
 * una contratista.
 */
export function etiquetaRol(rol, tipoEmpresa) {
  if (rol === 'supervisor_company') return tipoEmpresa === 'predefinida' ? 'Supervisor' : 'Administrador'
  return ETIQUETA.rol[rol] ?? rol
}

/** Estado de un documento según su fecha de vencimiento (regla de la app). */
export function estadoDocumento(venceEn, hoy = new Date()) {
  const dias = Math.floor((new Date(venceEn) - hoy) / 86400000)
  if (dias < 0) return 'vencido'
  if (dias <= 30) return 'por_vencer'
  return 'vigente'
}

/** Días que faltan (negativo si ya venció). */
export function diasPara(fecha, hoy = new Date()) {
  return Math.floor((new Date(fecha) - hoy) / 86400000)
}
