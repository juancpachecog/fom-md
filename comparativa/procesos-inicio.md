# Inicio, mapa, alertas, SOS, jornadas, PIN y reportes

## Inicio / Resumen
App: supervisor (app/panel/index.tsx) aviso rojo por cada SOS activo; «Hoy»: unidades listas para salir de N con motivos; «Control»: preventivos vencidos y próximos, alertas predictivas, papeles por vencer; «Período» del mes con índice, km y costos; botón Reporte; sin mapa. Conductor ((driver)/index.tsx): mapa a pantalla completa, SOS, telemetría, campana y píldora del PIN. Admin (admin/index.tsx): estado del sistema, cifras de empresas, usuarios y vehículos con su botón de crear, finanzas.
Web: supervisor (Resumen.jsx) flota en marcha, ODT abiertas, alertas nuevas, mapa en vivo, inspecciones de hoy, mantenimiento, documentos por vencer, ranking de manejo de 7 días. Conductor (MiUnidad.jsx) unidad, puntaje de manejo, mapa, cifras, «Hoy». Admin: sin inicio propio (va a Usuarios generales).
Para igualar: web → aviso de SOS, «listas para salir», bloque «Control», índice y km del mes con daily-metrics; inicio de admin con las cifras de la app. App → mapa en el resumen del supervisor si se quiere.

## Centro de control y mapa
App: mapa arriba de la flota con lista agrupada y etiquetas (SOS, Bloqueada, papel vencido, observaciones, sin conductor); filtro Sin señal; estela al destacar; admin con mapa multiempresa coloreado por empresa. Sin recorrido por horas.
Web: mapa a pantalla completa con buscador, chips, área, lista; cola punteada; «Ver recorrido» 6/12/24 h con viajes y paradas; llegada y alcance.
Error en la web: los chips «En marcha / Detenidas» del Centro de control no filtran.
Para igualar: web → arreglar el filtro, añadir «Sin señal» y etiquetas de novedad. App → «Ver recorrido» por horas.

## Alertas y avisos
App: supervisor (notificaciones.tsx) buzones Todas/ODT/Alertas/SOS, buscador, Sin leer/Leídas, deslizar para leída o eliminar. Conductor (mis-notificaciones.tsx) buzones Mi unidad/Órdenes/Personal desde sus alertas.
Web (Alertas.jsx, igual para todos): sin leer y de hoy; chips; marcar leída, descartar, marcar todas, descartar leídos.
Diferencias: la web no tiene buzón SOS ni buscador; la app no tiene acciones en bloque; el conductor web lee los avisos de la empresa y no sus alertas.
Para igualar: web → buzón SOS, buscador y alertas propias del conductor. App → «Marcar todas» y «Descartar leídos».

## Reglas de alerta
App: «reglas» = controles de mantenimiento por km; no hay regla de velocidad.
Web (Seguridad › Reglas): solo reglas de velocidad; los planes por km están en Mantenimiento.
Para igualar: misma palabra para lo mismo: «Velocidad» y «Control de mantenimiento» en las dos; regla de velocidad en la app.

## Eventos de manejo
App: cifras cada 100 km (excesos, frenadas, aceleraciones) en índices y kilómetros; no puede reconocer ni resolver.
Web: «Eventos de manejo» en Alertas (solo trae velocidad/condición: los chips de frenada y aceleración nunca tienen datos) y «Eventos de alerta» en Seguridad con Reconocer/Resolver.
Para igualar: web → renombrar o alimentar con driving-events. App → lista con Reconocer/Resolver.

## Emergencias y SOS
App: conductor reporta (tipo, descripción, ubicación), cierra con «Ya estoy bien» o «Falsa alarma». Supervisor: mapa, cómo llegar, «Me hago cargo» y luego «Cerrar el aviso»; el admin no tiene botones.
Web (Seguridad › SOS): lista con filtros, reconocer y resolver (resolver aunque no se haya reconocido), el admin también actúa; sin mapa ni «cómo llegar»; el conductor web no puede enviar un SOS.
Para igualar: web → resolver solo tras reconocer, sin botones para el admin, mapa y «cómo llegar», aviso en Resumen. App → historial con filtro por estado.

## Jornadas
App: solo abrir y cerrar jornada (con PIN); sin pantalla de consulta. Web (Jornadas.jsx): al volante ahora y tabla, solo lectura.
Para igualar: app → pantalla de Jornadas para el supervisor.

## PIN de la unidad
App: conductor ingresa PIN y deja el vehículo; supervisor autoriza secundarios con PIN y renueva PIN. Web: nada.
Para igualar: web → «Autorizar secundario» y «PIN nuevo» con las mismas llamadas.

## Reportes e índices
App: reportes con formatos, alcance, período «Mes actual» o personalizado, vista previa y PDF; índices por conductor; km por unidad; comparar empresas y multiempresa.
Web (Reportes.jsx): vistas por tema, 30/90/365 días, área, CSV e imprimir; dice «no disponible» en eventos cada 100 km.
Para igualar: web → leer daily-metrics, período por mes, comparar y multiempresa para admin. App → CSV.

Prioridad: 1) filtro de estado del Centro de control; 2) reglas de SOS; 3) PIN y secundarios en la web; 4) un solo origen para índice y km; 5) unificar «reglas» y «eventos»; 6) jornadas y acciones en bloque en la app.
