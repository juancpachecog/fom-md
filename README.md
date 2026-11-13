# FOM — Fleet Operations & Maintenance · Landing cinematográfica

## Publicación del panel conectado

`npm run build` exige el perfil de producción: API del mismo origen (`/fom-api`)
y mapas configurados. En un worktree limpio, indicar el directorio del perfil
nominal existente: `node scripts/build-fom-production.mjs <directorio>`.
No copiar archivos `.env`, claves ni tokens al repositorio o a registros.
`npm run build:demo` es sólo para demostraciones y no se publica como panel FOM.

Antes de sustituir la web publicada, comprobar `dist/fom-build-profile.json`,
su configuración efectiva y el manifiesto. El publicador debe rechazar perfiles
ausentes o de demostración. Contrastar también el módulo de autenticación con
la versión funcional y comprobar por separado acceso real, proveedor del mapa,
botón Capas y selección de tema. Un HTTP 401 del backend no demuestra que el
cliente esté conectado a esa API. Conservar la versión anterior y el retorno.

> **Relevo del rediseño v7 (25/09/2026):** leer [CONTINUAR-REDISENO.md](CONTINUAR-REDISENO.md) y el [plan de las 90 secciones](output/PLAN-IMPLEMENTACION-V7.md). En la rama `codex/rediseno-v6-fiel`, Inicio está implementado; las otras diez páginas siguen pendientes de aplicar. La descripción histórica de abajo no describe íntegramente el Inicio actual.

Experiencia web 3D controlada por scroll para presentar **FOM**, la plataforma de
control y monitoreo de flotas. El contenido, la paleta y la terminología están tomados
de la app real (`control-flotas-main`: Expo + Supabase): mapa en vivo, estados
**En marcha / Parada**, inspección diaria, **ODTs**, índice de manejo seguro,
documentos con vencimiento y sistema multi-marca. Todos los datos son simulados y todo
se renderiza localmente (sin Google Maps ni servicios de pago).

## Inicio rápido

```bash
npm install
npm run dev      # abre http://localhost:5173
npm run build    # build de producción en /dist
npm run preview  # sirve el build de producción
```

## La experiencia

Una introducción de ~480vh controlada por scroll (escena fija con `position: sticky`):

1. **Mapa general** — vista cenital estilo mapa de navegación nocturno: manzanas 3D,
   calles con nombres (Av. Intercomunal, Carretera Lara–Zulia, Puente Gral. Rafael
   Urdaneta…), pins tipo mapa, sedes (Base Maracaibo, Sucursal Cabimas, Taller Ciudad
   Ojeda), el Lago de Maracaibo y tráfico en movimiento.
2. **Acercamiento** — la cámara baja de la vista de mapa a una perspectiva 3D rumbo a
   Cabimas; las manzanas ganan volumen.
3. **Área operativa** — geocercas, foco sobre Cabimas y etiqueta glassmorphism
   (8 vehículos asignados · 6 unidades en marcha).
4. **Selección de la unidad** — el pin verde pulsa y crece; aparece el card de la
   Unidad FOM-024 (Toyota Hilux 2025, placa, conductor, empresa).
5. **La Hilux en escena** — el pin se transforma en la fotografía real integrada:
   sombra de contacto, reflejo, luces de acento, marcas de velocidad y parallax.
6. **Telemetría** — los campos reales de la app aparecen anclados alrededor del
   vehículo: GPS, velocidad, combustible, estado, índice de manejo seguro, última señal.
7. **Cierre** — la cámara retrocede a un plano 3/4 y entra el mensaje final
   ("Toda tu flota. Una sola plataforma."). La intro **no** entra al vehículo.

Después: landing con consola FOM-WEB ficticia, funciones reales (inspección diaria,
ODTs, índice de manejo seguro, documentos, reportes multi-empresa), productos
(FOM-WEB · FOM-DRIVER · FOM-TECH · FOM-CONTROL), áreas operativas, sistema multi-marca
(Samfor, Petrosur, Chevron, PDVSA Petroboscan), beneficios y llamada a la acción.

## Tecnologías

React 18 · Vite 5 · GSAP + ScrollTrigger · video HTML5 con scrub por scroll · CSS moderno.

## Decisiones técnicas principales

- **Paleta de la app real** (`src/theme/tokens.ts` del repo): fondo `#0A0D12`,
  superficie `#141A22`, azul FOM `#208AEF/#3D9BF5`, verde `#3DD68C`, gris `#ABB3BF`.
- **Estética de mapa**: el suelo tiene el color de las calles y las manzanas se apoyan
  encima — los huecos leen como vías sin geometría extra. Suelo y agua sin iluminación
  (tono uniforme de mapa); manzanas y torres con luz para el volumen 3D.
- **Fondo de la Hilux**: flood-fill desde los bordes del bitmap (conserva brillos y
  placa) + conversión de la franja inferior en sombra semitransparente proporcional al
  brillo (elimina el charco de luz del piso del estudio original).
- **Scroll**: un ScrollTrigger con scrub expone el progreso en un ref; cámara por
  keyframes (algunos relativos al vehículo) con suavizado por frame; overlays DOM sin
  re-renders. El ScrollTrigger se refresca al cambiar la altura de la intro por tier.
- **Rendimiento**: manzanas/torres/avenidas/tráfico instanciados, materiales
  compartidos, `dpr` ≤ 1.75, RNG determinista, render pausado fuera del viewport,
  sin sombras dinámicas.
- **Responsive**: tres niveles (desktop/tablet/móvil) con menos geometría y una intro
  más corta en móvil; el card, la selección y la Hilux se mantienen.
- **Accesibilidad**: "Saltar introducción", `prefers-reduced-motion` (escena estática),
  navegación por teclado, aria labels y contraste alto.

## Estructura

```
src/
  components/   Header, CinematicIntro, VehicleCard, Telemetry, DashboardPreview,
                Hero, Features, Branches, Benefits, CTA, Footer, LoadingScreen
  scenes/       CityScene (mapa 3D), VehicleScene (Hilux), CameraRig
  hooks/        useScrollProgress, useReducedMotion
  utils/        stages.js (timeline/cámara/ciudad), hiluxTexture.js (procesado de imagen)
  assets/       hilux.png
  styles/       global.css, cinematic.css, dashboard.css
```

## Personalización

- **Textos y datos simulados**: `VehicleCard.jsx`, `Telemetry.jsx`,
  `DashboardPreview.jsx`, `Features.jsx`, `Branches.jsx`, `Benefits.jsx`.
- **Paleta**: variables CSS en `src/styles/global.css`; colores del mapa en el objeto
  `MAP` de `CityScene.jsx`.
- **Mapa**: distritos, lago y avenida en `src/utils/stages.js`; nombres de calles y
  POIs en `STREET_LABELS` / `POI_LABELS` de `CityScene.jsx`.
- **Ritmo de la intro**: keyframes de cámara en `stages.js`; rangos de overlays e
  `INTRO_VH` en `CinematicIntro.jsx`.
- **Vehículo**: reemplaza `src/assets/hilux.png` por cualquier foto con fondo claro —
  el recorte es automático.
