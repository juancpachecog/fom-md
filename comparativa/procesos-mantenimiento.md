# Mantenimiento/ODT e Inspecciones

Diferencia general: la app escribe en /api/v1/mobile/*, la web en /api/v1/console/*. Las fotos no se cruzan. La web maneja 9 estados de orden; la app 3 (los de taller los muestra como "Abierta").

## Lista de órdenes (supervisor)
App (app/panel/mantenimiento.tsx): tarjeta "X de Y unidades al día"; buscador; filtros por tipo (Correctivo/Preventivo/Predictivo) y por área; tres colas «Atender ahora», «Próximas», «En revisión»; mezcla ODT con alertas; no muestra cerradas; botones «+ ODT» y «Control».
Web (modulos/Mantenimiento.jsx): pestañas Órdenes / Todas las órdenes / Planes; 4 indicadores (Por revisar, En proceso, Cerradas este mes, Costo acumulado); tablero «Necesita tu atención»; etapas Abiertas / En revisión / En taller / Finalizadas; tabla con descripción, unidad, tipo, falla, generó, creada, estado, costo.
Diferencias: la web muestra cerradas, costos y 9 estados; la app solo lo pendiente mezclado con alertas. La app filtra por área; la web no.
Para igualar: app → vista de cerradas con costo. Web → filtro por área y tarjeta «unidades al día».

## Crear orden (supervisor)
App (app/crear-odt.tsx): 1) unidad; 2) qué falló (opcional; si «Otro», escribir la parte 3–40); 3) gravedad baja/media/alta (media por defecto); 4) descripción 10–500. Sin fotos ni ubicación. POST /mobile/work-orders {vehicleId, description, kind, severity, failureType}.
Web (NuevaOdt): 1) unidad; 2) descripción (mín. 10, sin máx.), tipo de falla (marcado «motor»), ubicación (por defecto "Registrada desde el panel"), hasta 10 fotos. No pide gravedad. POST /console/work-orders {vehicleId, description, kind:'correctiva', failureType, location}.
Para igualar (web): añadir gravedad (media) como severity; no marcar «motor» de entrada; pedir la parte con «Otro»; máximo 500; quitar la ubicación inventada.

## Reportar falla (conductor)
App (app/reportar.tsx): unidad y ubicación por GPS; tipo de falla y parte; gravedad; descripción 10–500; al menos una foto con título (3–60). POST /mobile/vehicles/{id}/work-orders {description, severity, failureType, location}; fotos después por cola. La pestaña muestra ODT y alertas: Vencidas / Pendientes / Realizadas.
Web (MantenimientoConductor.jsx): mismo formulario del supervisor, sin gravedad, fotos opcionales y sin título, ubicación por defecto; listas «En curso» e «Historial» sin alertas; detalle con fotos e historial.
Para igualar (web): gravedad; exigir una foto con título; no usar ubicación por defecto; mostrar alertas de la unidad.

## Detalle, estados, responsable, ejecución y cierre
App (app/orden.tsx): selector de 3 estados (Abierta / En revisión / Resuelta); nota obligatoria (mín. 3); al resolver: «Qué se hizo» (mín. 3), costo USD opcional, fotos de factura, y odómetro si es preventiva. No tiene aprobar, asignar, ejecutar, pausar ni cancelar. Fallo: los estados de taller salen como "Abierta" y envía un expectedStatus traducido → el servidor responde 409.
Web (Detalle): ciclo completo abierta → en_revision → aprobada → asignada → en_ejecucion ⇄ pausada → en_calidad → cerrada, más cancelada y reabrir; asignar responsable; ejecución solo por el responsable. Nota opcional. No envía odómetro en preventivas. Factura en galería aparte.
Para igualar: app → guardar y enviar el estado real, mostrar los 9 estados, añadir aprobar/asignar/ejecutar/cancelar. Web → nota obligatoria mín. 3; un solo campo «Qué se hizo»; odómetro en preventivas; factura dentro del cierre.

## Fotos de evidencia
App: Cloudinary con etiqueta fom_odt_{id} (reporte) y fom_odt_cierre_{id} (cierre), lee por etiqueta.
Web: intenta el almacén del servidor; con él apagado sube a Cloudinary en fom/work-orders/{id}/... con etiqueta fom_work_orders_{id}.
Para igualar: elegir una sola forma (las etiquetas de la app o el almacén del servidor).

## Inspección diaria (conductor)
App ((driver)/inspeccion.tsx): plantilla del servidor; cada punto Conforme / Observación (nota) / Falla (nota, foto, ¿crear ODT?); todo obligatorio; falla crítica exige foto; si queda bloqueada avisa y deja pedir otra unidad.
Web: no existe para el conductor (correcto: es trabajo de campo).

## Lista e historial de inspecciones (supervisor)
App (app/inspecciones.tsx): Hoy / Historial; filtros Aprobadas / Con observaciones / Bloqueadas; «Hoy» agrupa por gravedad e incluye «Sin hacer»; imprimir varias en PDF; sin detalle en pantalla.
Web (modulos/Inspecciones.jsx): Resumen / Historial con fecha; tabla con tipo, unidad, conductor, resultado, observaciones, fallas críticas, ubicación; detalle en ventana. Fallos: lee solo 100, columnas de fallas y observaciones sin el número real, evidencias no se ven.
Para igualar: web → leer todo, calcular esos números, PDF y «Sin hacer». App → detalle en pantalla.

## Programar inspección, hallazgos y plantillas
Solo en la web (ProgramaInspecciones.jsx): programar (unidad, plantilla, responsable, fecha), cancelar con motivo, seguimiento de hallazgos, plantillas (puntos sin categoría ni ayuda).
Problemas: la app no lee las inspecciones programadas; las plantillas de la web llegan sin categorías; la app usa la primera plantilla publicada.
Para igualar: app → mostrar al conductor sus inspecciones programadas y hallazgos al supervisor. Web → categoría y ayuda por punto; vincular ODT al hallazgo.

Decisiones pendientes: (1) ciclo de la orden: ¿9 estados en las dos o 3? (2) fotos: ¿Cloudinary con etiquetas de la app o almacén del servidor?
