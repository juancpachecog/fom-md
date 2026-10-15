# Personas, empresas y administración

## Personal
App: listas por empresa (admin) y del supervisor (ver perfil solo lectura); crear usuario: nombre, apellido, email, país + teléfono, clave temporal; el rol depende del tipo de empresa (contratista: conductor o supervisor; compañía: solo supervisor; personal: supervisor o usuario); editar cédula (también documento extranjero), teléfono y rol; clave temporal; desactivar/reactivar; sacar de la empresa; reincorporar; asignar a otra empresa.
Web (AdminUsuarios.jsx): indicadores, buscador, filtros, tabla, CSV, menú Clave / Suspender / Revocar; crear sin teléfono y con roles que no dependen del tipo de empresa; editar cédula V/E, teléfono, dirección, nacimiento y fotos; licencia y aptitud médica de otra persona; cambiar rol solo en Plataforma; sin reincorporar.
Diferencias: teléfono al crear; roles por tipo de empresa; documento extranjero; la app no edita dirección ni nacimiento; la web no cambia rol desde Personal; la web manda motivo en cada cambio; nombres distintos de botones (Desactivar/Suspender, Sacar/Revocar); la app dice «Mín. 16» en la clave pero la regla real es otra.
Para igualar: web → teléfono al crear, roles por tipo de empresa, cambiar rol en la ficha, «Fuera de la empresa» con Reincorporar, documento extranjero. App → dirección, nacimiento y credenciales de otra persona, enviar motivo. Las dos → mismos nombres de botones.

## Completar perfil y Mi perfil
App: perfil obligatorio que bloquea la entrada (documento, teléfono, dirección, nacimiento, licencia y carta médica); Mi perfil sin editar el nombre; cambiar contraseña.
Web: Mi perfil editable para supervisor y admin (también el nombre); el conductor ve «usa la app»; no hay perfil obligatorio ni cambiar contraseña.
Para igualar: web → cambiar contraseña, pantalla de perfil obligatorio. Decidir si el nombre se edita.

## Empresas
App: lista por tipo; ficha con datos, cobros, personas, servicio, borrar y asociadas; crear con nombre, RIF, teléfono, correo, tipo y color obligatorios, contratista con al menos una compañía, y luego invitar supervisor; editar datos y color; sin logo.
Web: lista con ficha, entrar, subir logo, compañías asociadas, suspender/reactivar; crear solo con nombre obligatorio y sin color; no edita datos ni color.
Errores en la web: al crear se pierden las compañías elegidas; la asociación se guarda al revés; conteos de personas y vehículos sin dato.
Para igualar: web → mismo formulario y validaciones de la app, color, editar datos, arreglar asociaciones. App → subir logo cuando el almacén esté encendido.

## Usuarios generales
App: agrupados por empresa, con «sin acceso» y Reincorporar/Asignar. Web: tabla plana paginada con filtros y Cambiar rol.
Para igualar: web → agrupar por empresa y grupo «Sin acceso».

## Vehículos generales
App: mapa con lista por empresa y Nuevo. Web: tabla con filtros por empresa, tipo y señal, y Nueva unidad entrando a la empresa.
Para igualar: opcional, mapa en la web y filtro de señal en la app.

## Transferencias entre empresas
App: no existe (mueve personas revocando y asignando; no mueve vehículos). Web: personas y vehículos con doble control.
Decisión: camino oficial para cambiar de empresa.

## GPS
App: registra el equipo ya instalado en una unidad con muchos campos obligatorios (fabricante, modelo, IMEI 15, línea, ICCID, operadora, APN, protocolo, transporte); verificación al crear la unidad.
Web: registra al inventario con modelo, IMEI y línea; instala, desmonta y edita; sin verificar.
Para igualar: web → mismos campos y «registrar en una unidad». App → desmontar y editar.

## Auditoría
App: carpetas por año, mes y día, filtros y buscador, objetivo legible y empresa. Web: indicadores, categorías, selector de empresa (no filtra) y objetivo poco legible.
Para igualar: web → objetivo legible y filtro de empresa que funcione.

Decisiones: camino oficial para cambiar de empresa; si el nombre se edita; arreglar ya las asociaciones de empresas y el filtro de Auditoría; encender el almacén de archivos.
