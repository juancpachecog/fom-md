// ============================================================
// REPOSITORIO DEL PANEL — el conmutador
// ------------------------------------------------------------
// Única puerta de acceso a los datos para toda la consola. Decide, módulo por
// módulo, si la respuesta viene de la base de datos real o de la semilla:
//
//   · Con `VITE_FOM_API` configurado, lo que la API respalda hoy —flota,
//     posiciones, recorrido, áreas y conductores— sale de la base real, por la
//     superficie `/api/v1/console` del Issue #173.
//   · Todo lo demás —ODT, inspecciones, documentos, personal, alertas, pagos,
//     auditoría— todavía no existe en el esquema real y lo sirve la semilla.
//   · Sin `VITE_FOM_API`, absolutamente todo es semilla y el sitio funciona
//     igual, sin depender de que el túnel esté arriba.
//
// La mezcla es deliberada y temporal: permite ver flota real hoy sin dejar
// media consola en blanco. A medida que `fom-core` gane dominios, cada bloque
// se muda de un lado al otro sin tocar un solo módulo de la interfaz.
//
// Ver `infra/MAPA-DOMINIO-FOM02.md` para el orden previsto de esa mudanza.
// ============================================================

import { HAY_API } from './api'
import repoApi from './repoApi'
import { pagosApi } from './pagosApi'
import repoSemilla, { alCambiarDatos, reiniciarDatos } from './repoSemilla'

/** ¿Qué módulos están leyendo de la base real? Útil para avisarlo en pantalla. */
export const FUENTE_REAL = HAY_API
  ? ['vehiculos', 'recorrido', 'resumen', 'areas', 'conductores',
     'odts', 'inspecciones', 'documentos', 'alertas', 'reglas', 'costos']
  : []

/** ¿La consola está conectada a la base de datos de producción? */
export const CONECTADO = HAY_API
export const DIRECTORIO_REAL = HAY_API

// ── Conectado a la base: lo que no tiene respaldo real se declara vacío ─────
//
// Antes, los módulos sin endpoint (personal, costos, administración) seguían
// mostrando la semilla COMO SI fuera real. Un panel conectado que enseña
// datos inventados sin decirlo es peor que uno incompleto: alguien toma una
// decisión sobre un pago o un usuario que no existe.
//
// Regla nueva: conectado, cada dato viene de la base o no viene. Las
// escrituras sin superficie real fallan con un mensaje claro en vez de
// simular que funcionaron sobre memoria del navegador.

const NO_HAY_ESCRITURA = () =>
  Promise.reject(
    new Error(
      'Esta acción todavía no existe en el servidor: el bloque de escritura ' +
        'está pendiente de contrato. Los datos que ves son reales; crear y ' +
        'editar llegará con esa superficie.',
    ),
  )

// Lo que de verdad NO tiene superficie en el servidor todavia, con el motivo
// concreto. Cada texto dice que falta y, cuando existe, por donde se hace hoy.

const FALTA_ALERTAS_ANTIGUO =
  'Esa forma de marcar avisos quedó vieja: usa «marcar como leído» sobre el ' +
  'aviso, o «marcar todos».'

const FALTA_ARCHIVOS =
  'Adjuntar archivos todavía no está integrado en este panel. ' +
  'El documento sí se registra con su vencimiento, ' +
  'que es lo que se vigila.'

const FALTA_INSPECCIONES =
  'Las inspecciones se registran desde la app del conductor, que es quien ' +
  'revisa la unidad. Desde la consola todavía solo se consultan.'

const FALTA_GPS_CAMPO =
  'Verificar el equipo y probar el botón de pánico exigen tener el aparato ' +
  'delante: se hacen desde la app de campo, al comisionarlo. Registrarlo y ' +
  'asociarlo a una unidad sí se hace desde aquí.'

const FALTA_COSTOS =
  'La carga y edición de gastos no está integrada en este panel. ' +
  'El reporte consulta los gastos registrados en el servidor.'

/**
 * Igual que la anterior pero DICIENDO QUÉ FALTA.
 *
 * Un mensaje genérico deja al que lo lee sin saber si el problema es suyo, de
 * su permiso o del producto. Nombrar la pieza que falta convierte un callejón
 * sin salida en algo que se puede pedir, esperar o rodear.
 */
const faltaEnElServidor = (queFalta) => () =>
  Promise.reject(new Error(queFalta))

/**
 * Envuelve una colección de la semilla dejando reales las funciones que sí
 * tienen respaldo, y con un aviso PROPIO las que no.
 *
 * Lo importante es que ninguna quede sin definir: una función ausente revienta
 * con «no es una función», que no le dice nada a nadie.
 */
function conRespaldoParcial(coleccion, reales, avisos = {}) {
  const salida = { ...sinRespaldo(coleccion), ...reales }
  for (const [nombre, aviso] of Object.entries(avisos)) {
    salida[nombre] = faltaEnElServidor(aviso)
  }
  return salida
}

/** Sustituye una colección de la semilla por su versión honesta y vacía. */
function sinRespaldo(coleccion) {
  const vacia = {}
  for (const [nombre, fn] of Object.entries(coleccion)) {
    if (typeof fn !== 'function') continue
    // Los listados devuelven vacío; todo lo demás (crear, set, eliminar,
    // asignar…) rechaza con el aviso. `obtener` devuelve null: no encontrado.
    if (nombre === 'listar') vacia[nombre] = () => Promise.resolve([])
    else if (nombre === 'obtener') vacia[nombre] = () => Promise.resolve(null)
    else if (nombre === 'resumen') vacia[nombre] = () => Promise.resolve(null)
    else vacia[nombre] = NO_HAY_ESCRITURA
  }
  return vacia
}

/**
 * Los módulos de paridad con la consola de Juan (eventos y SOS, jornadas,
 * planes, transferencias, plataforma, programa de inspecciones) no tienen
 * semilla: nacieron ya conectados. En modo demostración cada llamada dice
 * eso, en vez de reventar con «no es una función».
 */
const SOLO_CON_BASE_REAL =
  'Esta pantalla solo funciona conectada a la base real. En modo demostración no hay datos de ejemplo para ella.'
function soloConBaseReal(forma) {
  const salida = {}
  for (const [nombre, valor] of Object.entries(forma)) {
    salida[nombre] = typeof valor === 'function' ? faltaEnElServidor(SOLO_CON_BASE_REAL) : soloConBaseReal(valor)
  }
  return salida
}

const repo = HAY_API
  ? {
      ...repoSemilla,

      // --- Sin respaldo real todavía: vacío honesto, nunca semilla ------
      // `personal` y `admin.usuarios` eran dos vistas de la MISMA gente, y la
      // primera devolvia lista vacia porque nunca tuvo servidor. Ahora las dos
      // leen del mismo sitio: la persona entera, con su cuenta, sus datos, la
      // unidad que maneja y el papel que le vence antes.
      personal: {
        ...sinRespaldo(repoSemilla.personal),
        listar: repoApi.gente.listar,
        obtener: repoApi.gente.obtener,
        actualizarPerfil: repoApi.gente.actualizarPerfil,
      },
      costos: conRespaldoParcial(repoSemilla.costos, repoApi.costos, {
        registrar: FALTA_COSTOS,
        actualizar: FALTA_COSTOS,
        crear: FALTA_COSTOS,
      }),
      empresa: () => Promise.resolve(null),
      // Paridad con la consola de Juan (18 sep 2026): reales, sin semilla.
      seguridad: repoApi.seguridad,
      jornadas: repoApi.jornadas,
      planes: repoApi.planes,
      transferencias: repoApi.transferencias,
      programaInspecciones: repoApi.programaInspecciones,
      admin: {
        plataforma: repoApi.plataforma,
        // Empresas, contratistas y áreas: reales desde el #250.
        empresas: conRespaldoParcial(
          repoSemilla.admin.empresas,
          repoApi.empresas,
        ),
        usuarios: {
          ...repoApi.admin.usuarios,
          // El mismo listado que «Personal»: una sola forma de la persona.
          listar: repoApi.gente.listar,
          actualizarPerfil: repoApi.gente.actualizarPerfil,
        },
        // Registrar, asociar y desmontar son reales desde el #260. Verificar
        // y probar el botón de pánico siguen siendo de campo: exigen el
        // aparato delante, y fingirlos desde una pantalla sería peor que no
        // tenerlos.
        gps: conRespaldoParcial(
          repoSemilla.admin.gps,
          repoApi.gpsEscritura,
          { verificar: FALTA_GPS_CAMPO, probarPanico: FALTA_GPS_CAMPO },
        ),
        pagos: pagosApi,
        // Bitácora real desde `GET /audit`.
        auditoria: repoApi.auditoria,
      },

      // --- Reales -------------------------------------------------------
      vehiculos: {
        ...sinRespaldo(repoSemilla.vehiculos),
        listar: repoApi.vehiculos.listar,
        obtener: repoApi.vehiculos.obtener,
        usuariosAsignados: repoApi.vehiculos.usuariosAsignados,
        odometro: repoApi.vehiculos.odometro,
        kmPorDia: repoApi.vehiculos.kmPorDia,
        registrarOdometro: repoApi.vehiculos.registrarOdometro,
        // Alta, edición, área y conductor: reales desde el #219.
        ...repoApi.vehiculosEscritura,
      },
      recorrido: repoApi.recorrido,
      recorridoDetallado: repoApi.recorridoDetallado,
      colaReciente: repoApi.colaReciente,
      resumen: repoApi.resumen,

      // Áreas y conductores pasan a ser reales: los sirve `/api/v1/console`
      // desde las tablas del #169. Antes las áreas devolvían una lista vacía a
      // propósito, porque las de la semilla habrían puesto filtros de mentira
      // sobre unidades reales.
      areas: repoApi.areas,
      // La semilla no tiene una colección `conductores` —los suyos viven en
      // `personal`—, así que esta es nueva y no envuelve nada.
      conductores: repoApi.conductores,

      // Operación y cumplimiento, desde las tablas de #170 y #171. Las
      // escrituras de la semilla se conservan donde existen: la superficie
      // real es de solo lectura todavía.
      manejo: repoApi.manejo,
      odts: {
        ...sinRespaldo(repoSemilla.odts),
        listar: repoApi.odts.listar,
        obtener: repoApi.odts.obtener,
        crear: repoApi.odts.crear,
        mover: repoApi.odts.mover,
        // El ciclo completo, como en la app: estado con nota, responsable y
        // eventos de ejecución. Antes «cambiarEstado» caía en el rechazo
        // genérico y ningún botón de la orden funcionaba.
        cambiarEstado: repoApi.odts.cambiarEstado,
        asignarResponsable: repoApi.odts.asignarResponsable,
        ejecucion: repoApi.odts.ejecucion,
        historial: repoApi.odts.historial,
        ejecutar: repoApi.odts.ejecutar,
      },
      inspecciones: conRespaldoParcial(
        repoSemilla.inspecciones,
        {
          listar: repoApi.inspecciones.listar,
          obtener: repoApi.inspecciones.obtener,
          pendientesHoy: repoApi.inspecciones.pendientesHoy,
          // Catálogo de puntos del checklist: es síncrono y no toca el
          // servidor, así que se conserva tal cual.
          itemsPlantilla: repoSemilla.inspecciones.itemsPlantilla,
        },
        { crear: FALTA_INSPECCIONES, registrar: FALTA_INSPECCIONES },
      ),
      documentos: conRespaldoParcial(
        repoSemilla.documentos,
        { listar: repoApi.documentos.listar, ...repoApi.documentosEscritura },
        // El ARCHIVO del documento (el PDF) es otra cosa que su registro: sin
        // una subida de objetos, aceptarlo aquí prometería un respaldo que no
        // existe.
        { subir: FALTA_ARCHIVOS },
      ),
      alertas: conRespaldoParcial(
        repoSemilla.alertas,
        { listar: repoApi.alertas.listar, eventos: repoApi.alertas.eventos, ...repoApi.avisosEscritura },
        {
          marcar: FALTA_ALERTAS_ANTIGUO,
          // Es una LECTURA, y le tocaba el aviso genérico de escritura: decía
          // «el bloque de escritura está pendiente» sobre algo que solo lee.
          // Un mensaje que describe mal el problema estorba más que uno corto.
        },
      ),
      reglas: conRespaldoParcial(
        repoSemilla.reglas,
        { listar: repoApi.reglas.listar, ...repoApi.reglasEscritura },
      ),
      // `areas` se INVOCA como función en cuatro pantallas —`repo.areas()`—,
      // así que sus escrituras se le cuelgan encima en vez de mezclarla en un
      // objeto: mezclarla la convertiría en objeto y todas esas pantallas
      // dejarían de cargar.
      areas: Object.assign(
        (...args) => repoApi.areas(...args),
        repoApi.areasEscritura,
      ),
    }
  : {
      ...repoSemilla,
      seguridad: soloConBaseReal(repoApi.seguridad),
      jornadas: soloConBaseReal(repoApi.jornadas),
      planes: soloConBaseReal(repoApi.planes),
      transferencias: soloConBaseReal(repoApi.transferencias),
      programaInspecciones: soloConBaseReal(repoApi.programaInspecciones),
      admin: {
        ...repoSemilla.admin,
        plataforma: soloConBaseReal(repoApi.plataforma),
        gps: { ...repoSemilla.admin.gps, sinEmparejar: faltaEnElServidor(SOLO_CON_BASE_REAL) },
      },
    }

export { alCambiarDatos, reiniciarDatos }
export { repo }
export default repo
