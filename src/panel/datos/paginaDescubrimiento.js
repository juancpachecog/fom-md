export function paginaDescubrimiento(dispositivos, busqueda = '', pagina = 0) {
  const q = busqueda.trim().toLowerCase()
  const lista = dispositivos.filter(d => `${d.imei} ${d.transporte} ${d.protocolo ?? ''}`.toLowerCase().includes(q))
  const totalPaginas = Math.max(1, Math.ceil(lista.length / 4))
  const actual = Math.min(Math.max(0, pagina), totalPaginas - 1)
  return { filas: lista.slice(actual * 4, (actual + 1) * 4), total: lista.length, pagina: actual, totalPaginas }
}
export function permiteRegistrarVisto({ guardando, estado, visto, seleccionado, puedeRegistrar }) {
  return !guardando && estado === 'ok' && !!visto && visto === seleccionado && puedeRegistrar === true
}
