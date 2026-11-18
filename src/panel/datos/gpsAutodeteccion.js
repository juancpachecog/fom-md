/** Operations use only server-resolved identity/context and independent readback. */
const uuid = id => { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id || '')) throw Error('Equipo inválido.'); return id }
export function apiAutodeteccion(pedir) {
  const get = (path, opts = {}) => pedir(`/api/v1/console/${path}`, { ...opts, empresaContexto: null })
  return {
    revisar: ({id,imei,transport}) => id ? get(`gps-devices/${uuid(id)}/frame-review`) : get('gps-discovery/review',{metodo:'POST',cuerpo:{imei,...(transport?{transport}:{})}}),
    detectar: ({ id, imei }) => id ? get(`gps-devices/${uuid(id)}/discovery`) : get('gps-discovery/inspect', { metodo: 'POST', cuerpo: { imei } }),
    leer: id => get(`gps-devices/${uuid(id)}/function-preferences`),
    async guardar(id, body, token) {
      const receipt = await get(`gps-devices/${uuid(id)}/function-preferences`, { metodo: 'PUT', cuerpo: body, idempotente: true, idempotencia: token })
      const current = await this.leer(id)
      const choices = rows => JSON.stringify([...rows].map(r => [r.semanticKey,r.definitionVersion,r.instance,r.selected]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))
      if (current.deviceId !== id || current.revision !== receipt.revision || current.profileId !== body.profileId || current.profileVersion !== body.profileVersion || choices(current.choices) !== choices(body.choices)) throw Error('La selección aún no tiene una lectura de confirmación. Reintenta la misma solicitud antes de continuar.')
      return current
    },
    async aplicar(id, body, token) {
      const receipt = await get(`gps-devices/${uuid(id)}/function-preferences/apply`, { metodo: 'POST', cuerpo: body, idempotente: true, idempotencia: token })
      const current = await get(`gps-installations/${uuid(body.assignmentId)}/functions`)
      if (receipt.assignmentId !== body.assignmentId || current.assignmentId !== body.assignmentId || current.installationVersion !== receipt.version) throw Error('Consulta las funciones de la instalación antes de reintentar.')
      return current
    },
  }
}
export const nombreSenal = key => ({ 'ignition.acc':'Contacto (ACC)', 'door.open':'Puerta', 'battery.level':'Batería', 'fuel.level':'Combustible', 'environment.humidity':'Humedad', 'environment.temperature':'Temperatura', 'navigation.altitude':'Altitud', 'navigation.heading':'Rumbo GPS', 'navigation.speed':'Velocidad GPS' }[key] || key)
export function valorSenal(signal) {
  if (!signal || signal.quality !== 'valid' || signal.value == null) return 'Sin lectura válida'
  if (typeof signal.value === 'boolean') return signal.key === 'door.open' ? (signal.value ? 'Abierta' : 'Cerrada') : signal.value ? 'ON' : 'OFF'
  return `${signal.value}${({percent:' %',meter:' m',degree:'°',kph:' km/h',unknown:' · unidad pendiente'})[signal.unit] || ''}`
}
export const funcionElegible = (profile, fn) => fn.direction === 'observation' && fn.interpretationSupport === 'implemented' && profile.nativeChannels.some(c => c.semanticKey === fn.semanticKey && c.definitionVersion === fn.definitionVersion)
export function propuestaDesdePerfil(profile, prior = null) {
  return { profileId: profile.profileId, profileVersion: profile.profileVersion, choices: profile.functions.filter(fn => funcionElegible(profile, fn)).map(fn => ({semanticKey:fn.semanticKey,definitionVersion:fn.definitionVersion,instance:1,
    selected: prior?.profileId === profile.profileId && prior?.profileVersion === profile.profileVersion && prior.choices.some(c => c.semanticKey === fn.semanticKey && c.definitionVersion === fn.definitionVersion && c.instance === 1 && c.selected) || false })) }
}

/** Called only after a completed installation. Failure never retries its creation. */
export async function funcionesTrasInstalar(id, { api, obtener, confirmar, token }) {
  try {
    const proposal = await api.leer(id)
    if (!proposal.revision || !proposal.choices.some(c => c.selected)) return ''
    const gps = await obtener(id)
    if (!gps.instalacionId) throw Error('La instalación no tiene una lectura de confirmación.')
    if (!await confirmar({titulo:'Usar las funciones elegidas',texto:'El GPS ya quedó instalado. ¿Aplicar ahora las funciones que seleccionaste al registrar el equipo? Los sensores necesitan comprobarse en este montaje.',accion:'Aplicar funciones',cancelar:'Más tarde'})) return 'La selección de funciones queda guardada para revisarla desde la ficha.'
    await api.aplicar(id,{assignmentId:gps.instalacionId,preferenceRevision:proposal.revision,expectedInstallationVersion:0},token)
    return 'Funciones aplicadas. Completa las comprobaciones de sensores en su ficha.'
  } catch(e) { return 'El vehículo y el GPS ya están asociados. La selección de funciones sigue pendiente; revísala en la ficha del equipo. '+e.message }
}
