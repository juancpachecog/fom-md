# Revisión del asistente GPS — Issue825

Alcance confirmado: equipos registrados sin instalar de Inventario; no borrar
recepciones crudas de «Detectados sin registrar».

| Área | Comprobación | Resultado |
| --- | --- | --- |
| Equipo | IMEI conocido opcional, identidad SMS coincidente antes de registrar | Pruebas y flujo React sintético |
| SIM | Teléfono/operador/APN, ICCID opcional con formato si informado | Pruebas y avance visual sin ICCID |
| Línea existente | Normalización nacional/internacional, lectura reciente y acceso a ficha | Pruebas y confirmación visual |
| Receptor | IPv4 requerida en build, TCP/UDP5001; no copiar placeholder | Guarda conservada de824 y pruebas |
| Meitrack | Contraseña4dígitos, identidad/firmware, capacidades, disponibilidad5002, lectura de retorno | Pruebas de protocolos y preparación; sin SMS físico |
| Alta | Sólo inventario; lectura independiente; intento incierto no repite POST | Pruebas y alta Coban sintética completa |
| Edición | Sin mutación vacía, SIM/serial limpiables; identidad inmutable | Pruebas, guardado y recarga visual |
| Retiro | Motivo requerido, adminFOM, sin instalación activa ni prueba abierta | API, invariantes e interfaz probadas |
| Historial | Archivo lógico/idempotente, sin borrar posiciones, mensajes ni instalaciones | Pruebas y testigo operacional separado |
| Publicación | Perfil API/mapas/GPS,49 pruebas antes del build y testigo gpsFlowVerified | Build rechaza fallos antes de producir release |

El modo de prueba usa ahora UUID de registro, conforme al contrato real; la
prueba visual detectó que sus identificadores anteriores no pasaban el testigo
de alta. También se retiró una clave duplicada idéntica del catálogo.

El módulo compilado de autenticación se conserva byte por byte respecto a824;
el retiro usa el cliente existente en el repositorio GPS sin modificar ese
módulo compartido. Los valores públicos del perfil permanecen iguales.

562 pruebas web aprobadas,49 del flujo ejecutadas de nuevo por el build. La
publicación exige después perfil exacto,manifiesto completo,API esperada y
testigo HTTPS independiente, con retorno al release previo. Esto reduce y
detecta regresiones cubiertas; no acredita pruebas físicas de hardware ni
garantiza ausencia absoluta de defectos futuros. Evidencia operacional en825.
