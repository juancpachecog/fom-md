// Un cambio sólo de rumbo también debe llegar a los marcadores.
export const firmaFlota = lista => lista.map(v => `${v.id}:${v.lat}:${v.lng}:${v.rumbo}:${v.posicionEn}:${v.estadoMarcha}:${v.velocidadKmh}:${v.ultimoReporte}:${v.conectado}:${v.soloRecepcion}:${v.conductorNombre}`).join('|') + (lista.incompleta ? '|incompleta' : '')
