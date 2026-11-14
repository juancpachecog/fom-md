// Las compañías se relacionan con la contratista; invertir el par es inválido.
export async function relacionesDeContratista(contratistaId, companias, listar) {
  const relaciones = []
  for (let i = 0; i < companias.length; i += 4) {
    const tanda = await Promise.all(companias.slice(i, i + 4).map(async c => ({ companiaId: c.id, items: await listar(c.id) })))
    for (const { companiaId, items } of tanda) for (const r of items) {
      if (r.contractorTenantId === contratistaId && r.active === true) relaciones.push({ ...r, companiaId })
    }
  }
  return relaciones
}

export async function cambiarCompanias(contratistaId, seleccion, companias, { listar, vincular, terminar }) {
  const ids = [...new Set(seleccion)]
  if (ids.some(id => !companias.some(c => c.id === id))) throw new Error('La selección contiene compañías no disponibles. Recarga antes de guardar.')
  const antes = await relacionesDeContratista(contratistaId, companias, listar)
  let fallo
  try {
    for (const r of antes) if (!ids.includes(r.companiaId)) await terminar(r.id)
    for (const id of ids) if (!antes.some(r => r.companiaId === id)) await vincular(id, contratistaId)
  } catch (e) { fallo = e }
  const despues = await relacionesDeContratista(contratistaId, companias, listar)
  const actuales = new Set(despues.map(r => r.companiaId))
  if (actuales.size !== ids.length || ids.some(id => !actuales.has(id))) throw new Error(`No quedó verificado el conjunto de asociaciones. Se conservan los cambios ya guardados; recarga antes de reintentar.${fallo ? ' Una operación no fue confirmada.' : ''}`)
  return true
}
