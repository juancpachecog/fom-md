# Flota, Documentos y Costos

## Flota: lista, filtros, mapa
App: admin (app/admin/flota.tsx) mapa arriba, filtro por empresa, buscador, Ver/Editar, «Nuevo». Supervisor (app/panel/flota.tsx) mapa de borde a borde, tira en marcha/detenidas/sin señal, lista agrupada «No pueden salir» / «Atención» / «Sin novedad» con la peor novedad de cada unidad; filtros por área y «Sin área», marcha, sin inspección hoy, papeles vencidos, orden abierta, pesados/livianos, sin conductor.
Web: supervisor (Flota.jsx) tabla sin mapa (el mapa está en Centro de control) con columnas ordenables, indicadores, estados, áreas, buscador y CSV. Admin: Vehículos generales.
Para igualar: web → mismos filtros y columna de «novedad»; si se quiere, mapa arriba de la tabla. App → orden por columnas y CSV.

## Crear vehículo (solo admin FOM)
App (crear-vehiculo.tsx), 4 pasos: 1) datos: Id de la unidad (sin espacios, hasta 50, no repetido), placa (letras y números, mayúsculas, no repetida), marca de catálogo, modelo, año 1950–2100, tipo (16 opciones), empresa, área y conductor opcionales; 2) papeles: vencimiento mes/año de Trimestres, RCV, Carné de circulación y Póliza; 3) crear: vehículo + área + 4 documentos + titular; 4) GPS ahora o después.
Web (Vehículos generales → empresa → alta): placa, alias, número interno, marca, modelo, año libre, tipo (4), GPS «obligatorio», área. El Id se inventa del alias. No crea papeles ni titular.
Para igualar: web → pedir el Id con la misma regla y validaciones, paso de 4 vencimientos, conductor principal opcional, GPS opcional. App → alias y número interno.

## Editar vehículo
App: admin corrige marca, modelo, año y placa. Web: solo el número interno.
Para igualar: web → «Editar» con esos 4 campos para admin. App → número interno.

## Asignar o quitar conductor
App (unidad.tsx «Quién la maneja»): titular (revocar + asignar), secundarios con PIN, renovar PIN, quitar.
Web (pestaña Usuarios): titular asignar/quitar con recuperación si falla; historial de jornadas; sin secundarios ni PIN.
Para igualar: web → secundarios con PIN; mismos motivos en las dos. App → recuperación ante fallos.

## Áreas
App (areas.tsx): lista, nueva (nombre, tipo, color), cambiar color. Web: nueva área sin color, agregar varias unidades a un área, sin lista de áreas.
Para igualar: web → color y lista de áreas. App → asignar varias unidades.

## Archivar unidad
App: admin, confirmación, sin motivo ni revisión previa. Web: supervisor y admin, revisa qué lo bloquea y pide motivo.
Para igualar: app → revisión previa y motivo; un solo rol en las dos.

## Ficha de la unidad
App (unidad.tsx): una página: estado, ficha (sin foto real), pendientes de mantenimiento, métricas del mes, ODT, quién la maneja, área y papeles (solo lectura).
Web (ExpedienteVehiculo.jsx): indicadores y 8 pestañas (Resumen, Ficha, Telemetría, Usuarios, Inspecciones, Mantenimiento, Documentos, Costos). La pestaña Costos sale siempre vacía.

## Odómetro
App: solo lo lee; se escribe al cerrar una ODT. Web: «Registrar el odómetro actual».
Para igualar: app → mismo botón.

## Fotos de la unidad
App: no hay. Web: sí (Cloudinary fom/vehiculo/{id}). Para igualar: app con la misma dirección.

## Documentos
App: solo papeles propios y de la unidad que maneja; el supervisor no tiene lista de la empresa; fecha por mes/año (último día del mes); fotos por cara con escáner; registrar papeles solo dentro del alta del vehículo.
Web (Documentos.jsx): indicadores, urgentes, vencimientos por mes, filtros, CSV; registrar con tipo libre, número, emisión, vencimiento exacto, notas y archivos; renovar; archivar.
Diferencias: códigos de tipo distintos (app: rcv, carnet_circulacion, poliza_seguro, trimestres, carta_medica; web: seguro_rcv, permiso_circulacion, poliza_casco, certificado_medico); fecha mes/año vs día exacto; las fotos se nombran distinto y no se cruzan.
Para igualar: un solo catálogo de tipos (el de la app); una sola forma de fecha (mes/año, último día); una sola forma de guardar fotos; app → lista de documentos de la empresa, registrar fuera del alta y archivar; web → quitar el cambio de fecha directo en la tabla del expediente.

## Costos
App (costos.tsx, costos-unidad.tsx, registrar-costo.tsx): período, total, productos vs servicios, por categoría, por unidad; anotar gasto con 12 categorías, USD, litros si es combustible, concepto, lugar, fecha no futura.
Web: no existe (la pestaña Costos del expediente sale vacía y el reporte solo suma ODT cerradas), aunque el servidor ya tiene la ruta.
Para igualar: web → Costos con las mismas llamadas, categorías y formulario.

Prioridades: 1) Costos en la web. 2) Mismo catálogo de documentos, misma fecha y mismas fotos. 3) Alta y edición de vehículo en la web como la app. 4) Secundarios con PIN y color de áreas en la web; odómetro, foto de la unidad, archivar con motivo y documentos de empresa en la app.
