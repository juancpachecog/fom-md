# Cuentas FOM y funciones GPS — #726

Autoridad: decisión directa de Juan del31oct2026, registrada en
[FOM Core #726](https://github.com/juancpachecog/fom-core/issues/726#issuecomment-6549490016).
La app usa cuentas, empresas y permisos resueltos por FOM Core. No se vinculan
identidades del prototipo con IDs/tokens/roles del servidor.

## Alcance y conservación

La entrada Expo Router usa `src/fom-app`, con sesión y GPS de `src/fom`.
`src/app`, `src/auth`, `src/services`, `src/session` y los datos existentes de
Supabase se conservan sin modificación. Sus módulos de demostración no están
en la navegación FOM ni se importan desde ella. Los demás dominios requieren
integración propia; no se presentan como funcionalidades reales por iniciar
sesión FOM. No hay migraciones, borrados, sincronización de cuentas o fallback
de autenticación a Supabase/mock.

Expo54/ReactNative0.81 se conservan. El AGENTS exige consultar documentación56;
se leyó sin actualizar el SDK. SecureStore~15.0.8 y Crypto~15.0.9 se fijaron por
el manifiesto bundledNativeModules de Expo54.0.35. El lock original no permitía
npmci por tres referencias transitivas @emnapi inconsistentes; se reparó el
lock junto a las dos dependencias requeridas, sin upgrade del framework.

## Sesión

Configurar `EXPO_PUBLIC_FOM_API_BASE_URL` con el origen HTTPS del ambiente
autorizado, y su prefijo de proxy si existe; las rutas añaden `/api/v1/mobile`.
No contiene credenciales ni datos de empresa. Sin configuración, el ingreso
queda deshabilitado. HTTP sólo se permite en desarrollo para loopback o el
puente local del emulador Android. No hay destino productivo predeterminado.

Login y selección explícita de empresa usan únicamente opciones del servidor.
`/auth/me` comprueba la identidad antes de abrir datos. La sesión restringida
sólo abre cambio inicial de contraseña; su finalización descarta tokens y
requiere nuevo ingreso. Los roles se muestran como llegan, sin convertirlos
en roles o cuentas del prototipo; las APIs determinan permisos y ámbito.

En Android/iOS, el par de tokens y vencimientos se guarda como un único valor
en SecureStore, bajo una clave propia y ligado al origen API. No se guardan
contraseñas, ni se toca AsyncStorage/Supabase. El preview web usa memoria,
sin persistencia en cookies/localStorage. La rotación es single-flight; un
resultado incierto descarta la sesión y no reintenta el refresh consumido.
Logout invalida localmente, solicita revocación y consulta aparte que el
Bearer anterior ya no abre `/auth/me`. La UI distingue un cierre incierto.

## Funciones

El inventario autorizado entrega `installationId`; nunca se deriva del ID del
GPS ni de datos demo. El catálogo se filtra por fabricante declarado y el
usuario escoge perfil/modelo/firmware/versionado. Sólo aparecen las funciones
de ese perfil, con requisitos y disponibilidad de interpretación explícitos.
Marca declarada no certifica la variante ni activa sensores por sí sola.

La solicitud incluye instancias, entradas, polaridad, unidades, escala y
desplazamiento; no ejecuta comandos ni cambia habilitación física. Lecturas
conservan ausencia, false/cero, calidad y frescura. El historial pagina diez
muestras por ventana UTC de24h. Los resultados comunicados por el gestor
seleccionan hasta8muestras exactas y no equivalen a certificación independiente.
Durante incertidumbre se mantienen clave/cuerpo; tras recibo se reintenta sólo
GET. Se confirma el registro exacto aparte antes de mostrar éxito. Una prueba
posterior deliberada tiene una clave nueva, incluso con el mismo resultado.

### Observaciones Meitrack — #727

El cliente conserva el evento UTC y la recepción como tiempos distintos, junto
con la evidencia temporal y la clasificación histórica entregadas por la API.
Un valor retenido con evidencia retirada o frescura desconocida no confirma el
estado actual. Para seleccionar muestras neutrales se exigen explícitamente
`historicalOnly=false`, `timeEvidenceCurrent=true` y `commissioningEligible=true`.
La selección se filtra de nuevo al crear una operación; una operación incierta
conserva su cuerpo y clave originales. El servidor revalida permisos, vigencia,
instalación y muestras en la transacción del reporte. El formato anterior Coban
mantiene su validación de recepción por el servidor. No se activa hardware,
habilitación de funciones ni comandos mediante esta presentación.

## Verificación

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run lint:fom
npm run test:fom
npx expo export --platform all --output-dir .fom-preview
node scripts/verify-fom-boundary.cjs
```

Las pruebas usan credenciales, tokens y datos sintéticos. Exportar bundles
Hermes Android/iOS y web no genera APK, instala una app, publica EAS ni acredita
ejecución en un teléfono. La prueba visual y cualquier testigo API se registran
por separado en Issues/PR, distinguiendo fixtures de entornos nominales.
No se acredita despliegue/migración, recepción Meitrack real, prueba física,
actuación de motor o rendimiento sostenido por esta entrega.
