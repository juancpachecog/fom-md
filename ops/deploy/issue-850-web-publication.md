# WEB850 — inicio por empresa y despedida de sesión

Ámbito de [core850](https://github.com/juancpachecog/fom-core/issues/850),
[WEB43](https://github.com/juancpachecog/fom-md/pull/43). Publicación separada de
la investigación del error nominal de transferencia y del borrado848.

La fuente funcional es `56c30be8ea49745b07112473701a384a6a9ce5d1`, con619pruebas
completas y23de sesión/inicio/salida; build conectado con el mismo perfil público
`b1470891795093611bbca035faf86d5c84bb8e14ccc606e87b4c98d29a931ee8`.
Se cambia intencionadamente JavaScript de sesión para aplicar15min; no cambia
el login del servidor, claves, configuración de cookie ni la recepción GPS.
No se acredita UAT visual nominal: el control de navegador quedó bloqueado.

El helper versionado sólo prepara archivos estáticos y cambia una raíz Nginx.
Pins de retorno: raíz `/var/www/fom-web/releases/issue-846-gps-review-eb29917`,
configuración `c4b25c2dc28e1ad46ee8f26b658ffd4505fa2f8a578466c02d50887f0cfcc964`,
índice `99ee4f409acef0eab583bc25bf142692e5a153b076fbe3fc703d87a94ce5624f`.
El fragmento móvil sigue en
`796e853c4fea379d2be037bc27ddb9fa3c87b68a277209f2d766bff30d4674b0`.
La API846 permanece en su imagen2183/contenedor36ea, con recibo propio ya
consumido que se consulta como baseline; no se repite su publicación.

Cada staging/activación exige contrato nuevo en850, helper/archivo/manifest por
SHA256, ventana de120s para iniciar e ID inmutable. Crear sólo el release850;
reutilizar archivos viejos tras comprobar tamaño/hash y conservar todos los
assets cacheados del release846. No borrar originales ni tocar datos/API.

Antes de activar se fijan recibos exactos de stage y API, se verifica salud de
API y TEST y se respalda Nginx. Un cambio atómico de raíz, nginx-t y una recarga;
después dos pasadas HTTPS estables y todos los JS/CSS contra manifest. Login,
selector y transferencia deben servir el mismo índice; rutas autenticadas siguen
negando anónimos. El helper inspecciona sólo metadatos proyectados de Docker,
sin copiar Config.Env a logs.

Ante fallo se restaura el Nginx protegido846 y se consulta aparte su índice.
Restauración incierta detiene el paso; nunca repetir activación o borrar un
release dudoso. Preservar recibos. GHA bloqueado por facturación no se presenta
como CI verde ni permite Ready/merge. Un resultado de publicación no acredita
la solución del caso de transferencia que todavía requiere paso/URL del usuario.

La preparaciónv1 se completó sin cambiar Nginx; queda conservada y no se activa.
El sucesorv2 añade revalidación para500/otros5xx: un fallo aislado conserva
la sesión si auth responde; una caída general protege la pantalla. No reutilizar
ni sobrescribir el contrato, archivo o recibo de v1.
