/** Solo ofrece continuar después de recibir el identificador del GPS registrado. */
export async function ofrecerVehiculoTrasGps(id, { confirmar, navegar, raiz }) {
  if (!id) return false
  const seguir = await confirmar({
    titulo: 'GPS registrado',
    texto: '¿Quieres registrar un vehículo ahora y asociarle este GPS? Podrás elegir la empresa y completar los datos antes de confirmar.',
    accion: 'Crear vehículo',
    cancelar: 'Más tarde',
  })
  if (!seguir) return false
  navegar(`${raiz}/${encodeURIComponent(id)}/instalar`, { state: { crearVehiculoTrasRegistro: true } })
  return true
}
