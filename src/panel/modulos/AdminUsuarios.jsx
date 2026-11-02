import { useState } from 'react'
import { REGLAS_CLAVE, validarClave } from '../../lib/clave'
import { Link, useSearchParams } from 'react-router-dom'
import repo, { DIRECTORIO_REAL } from '../datos/repo'
import { useDatos } from '../useDatos'
import { useSesion } from '../useSesion'
import {
  Buscador, Cabecera, Campo, Cargando, Chips, ErrorCarga, Kpi, Modal, Tag, Tarjeta, Vacio,
} from '../comp/ui'
import * as f from '../datos/formato'
import { ROLES_ASIGNABLES, etiquetaRol, puedeGestionarA } from '../datos/catalogos'
import { Icono } from '../Iconos'
import AccionesUsuario from '../comp/AccionesUsuario'
import { useConfirmar } from '../comp/Confirmar'
import { useVistaTelefono } from '../comp/movil-navegacion'
import UsuariosMovil from './UsuariosMovil'
import { PastillaManejo } from '../comp/ManejoConductor'
import './usuarios-perfil.css'
import '../../styles/movil-modulos.css'

// Gente pertenece a la empresa de la sesión. El directorio global vive
// en «Usuarios generales» y no se mezcla con esta vista.

/** El tipo de documento en palabras: los códigos son para agrupar, no para leer. */
function etiquetaDocumento(tipo) {
  const NOMBRES = {
    licencia_conducir: 'Licencia',
    certificado_medico: 'Certificado médico',
    rcv: 'RCV',
    cedula: 'Cédula',
  }
  return NOMBRES[tipo] ?? (tipo ? tipo.replace(/_/gu, ' ') : 'Documento')
}

/** Una celda de CSV: comillas dobles escapadas, como espera Excel. */
function celda(valor) {
  const t = String(valor ?? '').replace(/"/gu, '""')
  return `"${t}"`
}

/**
 * Descarga la lista sin librerías: Blob y enlace temporal.
 *
 * Venía de la pantalla «Personal» y se conserva al unirlas: quien la usaba
 * para pasarle el listado a alguien fuera del sistema lo seguirá necesitando,
 * y perder una función al fusionar dos pantallas es la peor forma de fusionar.
 */
function exportarCSV(lista) {
  const cabecera = [
    'Nombre', 'Cédula', 'Correo', 'Teléfono', 'Rol', 'Estado', 'Unidad',
    'Rol en la unidad', 'Perfil completo', 'Documento próximo',
    'Vence', 'Días', 'Documentos por vencer',
  ]
  const filas = lista.map((p) => [
    p.nombre,
    p.cedula ?? '',
    p.email,
    p.telefono ?? '',
    p.rolEtiqueta ?? p.rol,
    p.estado ?? '',
    p.unidadNombre ?? 'Sin unidad',
    p.rolEnUnidad ?? '',
    p.perfilCompleto ? 'Sí' : 'No',
    p.documentoTipo ? etiquetaDocumento(p.documentoTipo) : '',
    p.documentoVence ?? '',
    p.documentoDias ?? '',
    p.papelesPendientes ?? 0,
  ])
  const csv = [cabecera, ...filas].map((fila) => fila.map(celda).join(';')).join('\r\n')
  // El BOM evita que Excel rompa los acentos al abrir el archivo.
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = `gente-fom-${f.hoyISO()}.csv`
  document.body.appendChild(enlace)
  enlace.click()
  enlace.remove()
  URL.revokeObjectURL(url)
}

function cargar(q, empresaId, rol) {
  if (DIRECTORIO_REAL) {
    // El servidor resuelve la empresa desde la sesión, sin un empresa elegible.
    return Promise.all([
      repo.admin.usuarios.listar({ q, rol }),
      repo.admin.empresas.listar().catch(() => []),
    ]).then(([lista, empresas]) => ({ lista, empresas }))
  }
  if (!empresaId) return Promise.resolve({ lista: [], empresas: [] })
  return Promise.all([
    repo.admin.usuarios.listar({ q, empresaId, rol }),
    repo.admin.empresas.listar({}),
  ]).then(([lista, empresas]) => ({ lista, empresas }))
}

export default function AdminUsuarios() {
  const sesion = useSesion()
  const actor = sesion?.perfil
  const [q, setQ] = useState('')
  const empresaId = actor?.empresaId
  const [rol, setRol] = useState('')
  const [parametros, setParametros] = useSearchParams()
  const [creando, setCreando] = useState(() => parametros.get('nuevo') === '1')
  const cerrarCreacion = () => {
    setCreando(false)
    if (parametros.has('nuevo')) {
      const siguientes = new URLSearchParams(parametros)
      siguientes.delete('nuevo')
      setParametros(siguientes, { replace: true })
    }
  }
  const esMovil = useVistaTelefono()

  const { datos, estado, error, recargar } = useDatos(() => cargar(q, empresaId, rol), [q, empresaId, rol])
  const cuenta = useAccionesCuenta({ actor, alCambiar: recargar })
  const { aviso, restablecerClave, aDesempleados, eliminarDefinitivo, suspender, reactivar, revocarAcceso } = cuenta

  return (
    <>
      <Cabecera
        titulo="Usuarios"
        bajada={esMovil ? 'La gente de tu empresa.' : `Personal de ${actor?.empresa || 'tu empresa'}. Consulta sus roles, unidades y documentos.`}
      >
        {/* En el teléfono «Exportar» va en la hoja de filtros: arriba solo queda «Nuevo usuario». */}
        {!esMovil && <button
          type="button"
          className="pnl-btn"
          onClick={() => exportarCSV(datos?.lista ?? [])}
          disabled={(datos?.lista ?? []).length === 0}
        >
          <Icono nombre="descargar" tam={16} />
          Exportar
        </button>}
        {(datos?.lista?.alcance?.administrable ?? true) && (
          <button type="button" className="pnl-btn primario" onClick={() => setCreando(true)} aria-label="Nuevo usuario">
            <Icono nombre="mas" tam={16} />
            {/* En el teléfono, «Nuevo» a secas, como el BotonNuevo de panel/personal.tsx. */}
            {esMovil ? 'Nuevo' : 'Nuevo usuario'}
          </button>
        )}
      </Cabecera>

      <div className="pnl-cuerpo usr-directorio">
        {estado === 'cargando' && <Cargando filas={6} />}
        {estado === 'error' && <ErrorCarga onReintentar={recargar} error={error} />}
        {estado === 'ok' && (
          <Contenido
            datos={datos}
            q={q}
            setQ={setQ}
            rol={rol}
            setRol={setRol}
            aviso={aviso}
            restablecerClave={restablecerClave}
            aDesempleados={aDesempleados}
            eliminarDefinitivo={eliminarDefinitivo}
            abrirMover={cuenta.hacer.mover}
            directorioReal={DIRECTORIO_REAL}
            actor={actor}
            suspender={suspender}
            reactivar={reactivar}
            revocarAcceso={revocarAcceso}
          />
        )}
      </div>

      {estado === 'ok' && (
        <>
          <ModalCrear
            abierto={creando}
            empresas={datos.empresas}
            alCerrar={cerrarCreacion}
            alGuardar={recargar}
            directorioReal={DIRECTORIO_REAL}
            actor={actor}
          />
          {cuenta.modalMover(datos.empresas)}
        </>
      )}

      {cuenta.modalClave}
    </>
  )
}

/**
 * LAS ACCIONES DE UNA CUENTA: clave, suspender, reactivar, revocar, mover y
 * dar salida, con sus preguntas de confirmación. Las usan el menú «⋮» de la
 * lista (computadora) y el perfil de la persona en el teléfono, que es donde
 * las tiene la app: mismas funciones, mismos permisos (`accionesDeCuenta`).
 * `alCambiar` se llama tras cada cambio para releer lo que se ve.
 */
export function useAccionesCuenta({ actor, alCambiar }) {
  const [moviendo, setMoviendo] = useState(null)
  const [claveDe, setClaveDe] = useState(null) // {nombre, clave} tras restablecer
  const [aviso, setAviso] = useState('')
  const { confirmar, dialogo } = useConfirmar()

  const accion = async (fn) => {
    setAviso('')
    try {
      await fn()
      await alCambiar?.()
    } catch (e) {
      setAviso(e.message)
    }
  }

  const restablecerClave = async (p) => {
    const pregunta = DIRECTORIO_REAL
      ? `Se generará una clave temporal nueva para ${p.nombre}. La anterior deja de servir y sus sesiones abiertas se cierran. ¿Continuar?`
      : `¿Restablecer la clave de ${p.nombre} a la por defecto?`
    if (!await confirmar({ titulo: 'Restablecer clave', texto: pregunta, accion: 'Restablecer', peligro: true })) return
    setAviso('')
    try {
      const r = await repo.admin.usuarios.cambiarClave(p.id, actor, { empresaId: p.empresaId })
      setClaveDe({ nombre: p.nombre, clave: r.clave })
      await alCambiar?.()
    } catch (e) {
      setAviso(e.message)
    }
  }

  const aDesempleados = async (p) => {
    if (!await confirmar({ titulo: 'Dar salida', texto: `${p.nombre} saldrá de ${p.empresaNombre} y su cuenta pasará a Desempleados C.A. ¿Continuar?`, accion: 'Dar salida', peligro: true })) return
    accion(() => repo.admin.usuarios.enviarADesempleados(p.id, actor))
  }

  const eliminarDefinitivo = async (p) => {
    if (!await confirmar({ titulo: 'Eliminar cuenta', texto: `¿Eliminar DEFINITIVAMENTE la cuenta de ${p.nombre}?`, accion: 'Eliminar', peligro: true })) return
    if (!await confirmar({ titulo: 'Eliminar cuenta', texto: 'Esta acción no se puede deshacer. ¿Confirmas?', accion: 'Sí, eliminar', peligro: true })) return
    accion(() => repo.admin.usuarios.eliminarDefinitivo(p.id, actor))
  }

  // Las tres acciones que el servidor SI sabe hacer sobre una cuenta. Ninguna
  // borra: suspender se deshace, revocar es terminal pero deja el rastro.
  const suspender = async (p) => {
    if (!await confirmar({ titulo: 'Suspender cuenta', texto: `${p.nombre} no podrá entrar hasta que la reactives. ¿Suspender?`, accion: 'Suspender', peligro: true })) return
    accion(() => repo.admin.usuarios.suspender(p.id, 'Suspendida desde la consola'))
  }
  const reactivar = (p) => {
    accion(() => repo.admin.usuarios.reactivar(p.id, 'Reactivada desde la consola'))
  }
  const revocarAcceso = async (p) => {
    if (!await confirmar({ titulo: 'Revocar acceso', texto: `Revocar el acceso de ${p.nombre} es definitivo: no se puede volver a activar, aunque su historial queda. ¿Continuar?`, accion: 'Revocar', peligro: true })) return
    accion(() => repo.admin.usuarios.eliminar(p.id))
  }

  /** Lo que hace cada acción de `accionesDeCuenta`. */
  const hacer = {
    clave: restablecerClave, suspender, reactivar, revocar: revocarAcceso,
    mover: setMoviendo, eliminar: eliminarDefinitivo, salida: aDesempleados,
  }

  const modalMover = (empresas) => !DIRECTORIO_REAL && (
    <ModalMover usuario={moviendo} empresas={empresas ?? []} alCerrar={() => setMoviendo(null)} alGuardar={alCambiar} actor={actor} />
  )

  const modalClave = (
    <>
    {dialogo}
    <Modal titulo="Clave restablecida" abierto={!!claveDe} alCerrar={() => setClaveDe(null)} ancho={440}>
      {claveDe && (
        <>
          <p>
            La clave de <b>{claveDe.nombre}</b> quedó en <code>{claveDe.clave}</code>.
          </p>
          <p className="pnl-campo-ayuda">
            Entrégasela en persona: deberá cambiarla al entrar. No se volverá a mostrar.
          </p>
          <div className="pnl-chips">
            <button type="button" className="pnl-btn primario" onClick={() => setClaveDe(null)}>
              Entendido
            </button>
          </div>
        </>
      )}
    </Modal>
    </>
  )

  return { aviso, setAviso, hacer, modalMover, modalClave, restablecerClave, aDesempleados, eliminarDefinitivo, suspender, reactivar, revocarAcceso }
}

/** El nombre de cada acción en su botón. */
const TEXTO_ACCION = {
  clave: 'Clave', suspender: 'Suspender', reactivar: 'Reactivar', revocar: 'Revocar',
  mover: 'Mover', eliminar: 'Eliminar', salida: 'Dar salida',
}

/**
 * Qué acciones se le ofrecen a quien administra sobre esta persona, en orden.
 * En modo conectado solo las que el servidor sabe hacer, y solo sobre quien el
 * rango del actor puede administrar: ofrecer un botón que va a devolver 403 es
 * peor que no ofrecerlo. `lista` es la lectura de Usuarios (trae el alcance).
 */
export function accionesDeCuenta(p, { lista, actor, directorioReal }) {
  if (directorioReal && (lista?.alcance?.administrable ?? true) && puedeAdministrar(actor, p)) {
    return [
      'clave',
      p.estado === 'suspended' ? 'reactivar' : p.estado === 'active' ? 'suspender' : null,
      p.estado !== 'revoked' ? 'revocar' : null,
    ].filter(Boolean)
  }
  // En la demo, la misma regla de rango que el repositorio (puedeGestionarA): nadie se administra
  // a sí mismo ni a alguien de su rango o mayor.
  if (!directorioReal && p.rol !== 'admin' && puedeGestionarA(actor, p)) return ['mover', 'clave', p.esDesempleado ? 'eliminar' : 'salida']
  return []
}

/**
 * Las acciones de la cuenta en el PERFIL de la persona, en el teléfono: la app
 * no tiene el menú «⋮» en la lista y las pone aquí. `persona` es la ficha que ya
 * leyó el perfil (id, userId, email, rol, estado, administrable): sirve de fila
 * y de alcance, sin volver a pedir el directorio. Mismos permisos que la lista.
 * Si no se le puede hacer nada, no aparece.
 */
export function AccionesCuentaMovil({ persona, alCambiar }) {
  const sesion = useSesion()
  const actor = sesion?.perfil
  const cuenta = useAccionesCuenta({ actor, alCambiar })
  // Las empresas solo hacen falta para «Mover» (solo en la demo): se piden al abrirlo.
  const [empresas, setEmpresas] = useState(null)
  const acciones = persona
    ? accionesDeCuenta(persona, { lista: { alcance: { administrable: persona.administrable } }, actor, directorioReal: DIRECTORIO_REAL })
    : []
  if (acciones.length === 0) return null

  const hacer = async (a) => {
    if (a === 'mover' && !DIRECTORIO_REAL && !empresas) {
      cuenta.setAviso('')
      try {
        setEmpresas(await repo.admin.empresas.listar({}))
      } catch (e) {
        cuenta.setAviso(e.message)
        return
      }
    }
    cuenta.hacer[a](persona)
  }

  return (
    <section className="pnl-card usr-cuenta-movil" aria-labelledby="usr-cuenta-titulo">
      <div className="pnl-card-cab"><h2 id="usr-cuenta-titulo">Cuenta</h2></div>
      <div className="pnl-card-cuerpo">
        {cuenta.aviso && <p className="pnl-campo-error" role="alert">{cuenta.aviso}</p>}
        <div className="pnl-chips">
          {acciones.map((a) => (
            <button key={a} type="button" className={`pnl-btn sutil${['revocar', 'eliminar', 'salida', 'suspender'].includes(a) ? ' peligro' : ''}`}
              onClick={() => hacer(a)}>
              {TEXTO_ACCION[a]}
            </button>
          ))}
        </div>
      </div>
      {cuenta.modalMover(empresas)}
      {cuenta.modalClave}
    </section>
  )
}

function Contenido({
  datos, q, setQ, rol, setRol, aviso,
  restablecerClave, aDesempleados, eliminarDefinitivo, abrirMover, directorioReal,
  actor, suspender, reactivar, revocarAcceso,
}) {
  const { lista } = datos
  // Una sola lectura del ranking de manejo (7 días, guardada unos minutos) para todas las filas.
  // Si el servidor no lo da, la lista sale igual, sin pastillas.
  const hayConductores = lista.some((p) => p.conduce)
  const { datos: ranking } = useDatos(() => (hayConductores ? repo.manejo.ranking({ dias: 7 }).catch(() => null) : Promise.resolve(null)), [hayConductores])
  const manejoPorId = new Map((ranking ?? []).map((m) => [m.id, m]))
  const esMovil = useVistaTelefono()
  const opcionesRol = directorioReal
    ? [
        { v: '', t: 'Todos' },
        { v: 'conductor', t: 'Conductores' },
        { v: 'supervisor', t: 'Supervisores' },
        { v: 'usuario', t: 'Usuarios' },
      ]
    : [
        { v: '', t: 'Todos' },
        { v: 'conductor', t: 'Conductores' },
        { v: 'supervisor_company', t: 'Supervisores' },
        { v: 'supervisor_personal', t: 'Personales' },
      ]

  // Las acciones de una cuenta en el menú «⋮»: las de `accionesDeCuenta`, las
  // mismas que el perfil de la persona ofrece en el teléfono.
  function accionesDe(p) {
    const permitidas = accionesDeCuenta(p, { lista, actor, directorioReal })
    if (permitidas.length === 0) return null
    const hacer = {
      clave: restablecerClave, suspender, reactivar, revocar: revocarAcceso,
      mover: abrirMover, eliminar: eliminarDefinitivo, salida: aDesempleados,
    }
    return (
      <AccionesUsuario nombre={p.nombre}>
      <div className="pnl-chips">
        {permitidas.map((a) => (
          <button key={a} type="button" className="pnl-btn sutil" onClick={() => hacer[a](p)}>
            {TEXTO_ACCION[a]}
          </button>
        ))}
      </div>
      </AccionesUsuario>
    )
  }

  // En la vista de teléfono, la pestaña de la app: tira, buscador con filtros y una lista de personas.
  if (esMovil) return <UsuariosMovil lista={lista} q={q} setQ={setQ} rol={rol} setRol={setRol} opcionesRol={opcionesRol}
    aviso={aviso} manejoPorId={manejoPorId} alExportar={() => exportarCSV(lista)} />

  return (
    <>
      <div className="pnl-grid k4">
        <Kpi titulo="Cuentas" valor={lista.length} icono="gente" nota="En el filtro actual" />
        <Kpi titulo="Conductores" valor={lista.filter((p) => p.conduce).length} icono="camion" nota="Con permiso de manejo" />
        <Kpi titulo="Perfiles completos" valor={lista.filter((p) => p.perfilCompleto).length} icono="gente" nota="Información personal completa" />
        <Kpi titulo="Documentos por atender" valor={lista.filter((p) => p.papelesPendientes > 0 || (p.documentoDias != null && p.documentoDias <= 30)).length} icono="documento" tono="aviso" nota="Personas con vencimientos" />
      </div>

      {aviso && <p className="pnl-campo-error" role="alert">{aviso}</p>}

      <Tarjeta
        titulo="Cuentas"
        accion={<Buscador valor={q} alCambiar={setQ} placeholder="Buscar por nombre, correo o cédula…" />}
        sinCuerpo
      >
        <div className="pnl-card-cuerpo">
          <Chips
            opciones={opcionesRol}
            valor={rol}
            alCambiar={setRol}
          />
        </div>

        {lista.length === 0 ? (
          <div className="pnl-card-cuerpo">
            <Vacio icono="gente" titulo="Sin cuentas que mostrar" texto="Prueba con otro filtro o crea el primer usuario." />
          </div>
        ) : (
          <div className="pnl-tabla-wrap">
            <table className="pnl-tabla mv-lista">
              <thead>
                <tr>
                  <th>Persona</th>
                  <th>{directorioReal ? 'Unidad' : 'Empresa'}</th>
                  <th>Rol</th>
                  <th>Señales</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {lista.map((p) => (
                  <tr key={p.id} className={`mv-ir${p.estado === 'revoked' || (p.documentoDias != null && p.documentoDias < 0) ? ' mv-u1' : p.estado === 'suspended' || p.claveTemporal || (p.documentoDias != null && p.documentoDias <= 30) ? ' mv-u2' : ''}`}>
                    <td className="mv-t">
                      <div className="pnl-persona">
                        <i className="pnl-avatar">{f.iniciales(p.nombre)}</i>
                        <div className="pnl-doble">
                          <Link className="usr-nombre mv-estira" to={`/panel/personal/${encodeURIComponent(p.userId ?? p.id)}`}>{p.nombre}</Link>
                          {/* La empresa debajo del nombre, como pidio Marco: en la
                              vista de un contratista, o en la del admin FOM, es lo
                              que distingue a dos personas con el mismo nombre. Si
                              el nombre del empresa no se resolvio, no se inventa. */}
                          <span>
                            {p.empresaNombre ? `${p.empresaNombre} · ` : ''}
                            {p.email}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="mv-d">
                      {/* La unidad que maneja HOY. Antes esto vivía en la
                          pantalla «Personal», que estaba vacía porque nunca
                          tuvo servidor. Verlo aquí ahorra el cruce entre dos
                          pantallas, que es donde se pierden los vencimientos. */}
                      {directorioReal ? (
                        p.unidadNombre ? (
                          <div className="pnl-doble">
                            <b>{p.unidadNombre}</b>
                            {p.rolEnUnidad && <span>{p.rolEnUnidad}</span>}
                          </div>
                        ) : (
                          <span className="pnl-tenue">Sin unidad</span>
                        )
                      ) : (
                        p.empresaNombre
                      )}
                    </td>
                    <td className="mv-e">
                      <Tag color={p.rol === 'admin' ? 'azul' : 'gris'} plano>{p.rolEtiqueta}</Tag>
                      {p.conduce && manejoPorId.has(p.userId ?? p.id) && <> <PastillaManejo score={manejoPorId.get(p.userId ?? p.id)} /></>}
                    </td>
                    <td className="mv-pie">
                      <div className="pnl-chips">
                        {p.claveTemporal && <Tag color="ambar" plano>Clave temporal</Tag>}
                        {p.esDesempleado && <Tag color="gris">Desempleado</Tag>}
                        {p.estado === 'suspended' && <Tag color="ambar">Suspendido</Tag>}
                        {p.estado === 'revoked' && <Tag color="rojo">Sin acceso</Tag>}
                        {!p.perfilCompleto && <Tag color="gris" plano>Perfil incompleto</Tag>}
                        {p.perfilCompleto && <Tag color="verde" plano>Perfil completo</Tag>}
                        {/* Los días los cuenta la base con su propia fecha:
                            juzgar un vencimiento con el reloj del navegador
                            cambia la respuesta según quién abra la pantalla. */}
                        {p.documentoDias !== null && p.documentoDias !== undefined && (
                          p.documentoDias < 0 ? (
                            <Tag color="rojo">{etiquetaDocumento(p.documentoTipo)} vencida</Tag>
                          ) : p.documentoDias <= 30 ? (
                            <Tag color="ambar">
                              {etiquetaDocumento(p.documentoTipo)} vence en {p.documentoDias} d
                            </Tag>
                          ) : null
                        )}
                        {p.papelesPendientes > 1 && (
                          <Tag color="gris" plano>{f.cantidad(p.papelesPendientes, 'documento por vencer', 'documentos por vencer')}</Tag>
                        )}
                      </div>
                    </td>
                    <td className="num mv-a">
                      <div className="usr-acciones-fila">
                        <Link className="usr-ver-perfil" to={`/panel/personal/${encodeURIComponent(p.userId ?? p.id)}`} aria-label={`Ver perfil de ${p.nombre}`}>
                          Ver perfil <Icono nombre="volver" tam={16} />
                        </Link>
                      {accionesDe(p)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>
    </>
  )
}

/**
 * Misma regla que `puedeAdministrarA` en el servidor: nadie se administra a si
 * mismo, nadie administra a un admin FOM, y solo se administra hacia abajo. Se
 * repite aqui para no pintar botones que el servidor va a rechazar; la que
 * manda sigue siendo la del servidor.
 */
export function ModalCambiarRol({ persona, alCerrar, alGuardar }) {
  const [rol, setRol] = useState(persona.rol)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const opciones = [{v:'supervisor',t:'Supervisor'}, {v:'conductor',t:'Conductor'}, {v:'usuario',t:'Usuario'}]
  const guardar = async () => {
    if (guardando || rol === persona.rol || !opciones.some(o => o.v === rol)) return
    setGuardando(true)
    setError('')
    try {
      if (!persona.empresaId || !persona.userId) throw new Error('Selecciona una persona y su empresa desde Usuarios generales.')
      await repo.admin.usuarios.cambiar(persona.userId, {rol, empresaId: persona.empresaId, motivo:'cambio-de-rol-desde-plataforma'})
      await alGuardar()
      alCerrar()
    } catch (e) { setError(e.message || 'No se pudo cambiar el rol.') }
    finally { setGuardando(false) }
  }
  return <Modal titulo="Cambiar rol" abierto alCerrar={() => { if (!guardando) alCerrar() }} ancho={480}>
    <p><b>{persona.nombre}</b> · {persona.email}</p>
    <p>Empresa: <b>{persona.empresaNombre}</b></p>
    <p>Rol actual: <b>{persona.rolEtiqueta || persona.rol}</b></p>
    <Campo etiqueta="Nuevo rol" error={error}>
      <select className="pnl-input" aria-label="Nuevo rol" value={rol} disabled={guardando} onChange={e => { setRol(e.target.value); setError('') }}>
        {!opciones.some(o => o.v === rol) && <option value={rol} disabled>Selecciona un rol</option>}
        {opciones.map(o => <option key={o.v} value={o.v}>{o.t}</option>)}
      </select>
    </Campo>
    <p className="pnl-campo-ayuda">Al confirmar cambiarán sus permisos en esta empresa. El servidor valida si sus asignaciones permiten el cambio.</p>
    <div className="pnl-chips">
      <button type="button" className="pnl-btn primario" disabled={guardando || rol === persona.rol || !opciones.some(o => o.v === rol)} onClick={guardar}>{guardando ? 'Guardando…' : 'Confirmar cambio'}</button>
      <button type="button" className="pnl-btn sutil" disabled={guardando} onClick={alCerrar}>Cancelar</button>
    </div>
  </Modal>
}

const RANGO = { admin_fom: 4, supervisor: 3 }
function puedeAdministrar(actor, objetivo) {
  if (!actor || !objetivo) return false
  if (actor.correo && objetivo.email && actor.correo === objetivo.email) return false
  if (objetivo.rol === 'admin_fom') return false
  const rangoActor = RANGO[actor.rol] ?? 1
  if (rangoActor < 3) return false
  return rangoActor > (RANGO[objetivo.rol] ?? 1)
}

const GRUPOS_CLAVE = [
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  'abcdefghijkmnopqrstuvwxyz',
  '23456789',
  '!@#$%*-_',
]
const CARACTERES_CLAVE = GRUPOS_CLAVE.join('')

function indiceAleatorio(limite) {
  const bytes = new Uint32Array(1)
  crypto.getRandomValues(bytes)
  return bytes[0] % limite
}

function generarClaveTemporal() {
  const caracteres = GRUPOS_CLAVE.map((grupo) => grupo[indiceAleatorio(grupo.length)])
  while (caracteres.length < 20) {
    caracteres.push(CARACTERES_CLAVE[indiceAleatorio(CARACTERES_CLAVE.length)])
  }
  for (let i = caracteres.length - 1; i > 0; i -= 1) {
    const j = indiceAleatorio(i + 1)
    ;[caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]]
  }
  return caracteres.join('')
}

export function ModalCrear({ abierto, empresas, alCerrar, alGuardar, actor, directorioReal, global = false, empresaInicial = '' }) {
  const [nombre, setNombre] = useState('')
  const [apellido, setApellido] = useState('')
  const [email, setEmail] = useState('')
  const [empresaDemoId, setEmpresaId] = useState(empresaInicial)
  const empresaId = directorioReal && !global ? actor?.empresaId : empresaDemoId
  const [rol, setRol] = useState('conductor')
  const [conduce, setConduce] = useState(false)
  const [clave, setClave] = useState(() => generarClaveTemporal())
  const [error, setError] = useState('')
  const [creado, setCreado] = useState(null) // {nombre, clave}
  const [guardando, setGuardando] = useState(false)

  const destino = empresas.find((e) => e.id === empresaId)
  const destinos = empresas.filter((e) => !e.respaldo)

  const cerrar = () => {
    setNombre(''); setApellido(''); setEmail(''); setEmpresaId(''); setRol('conductor')
    setConduce(false); setClave(generarClaveTemporal()); setError(''); setCreado(null)
    alCerrar()
  }

  const confirmar = async () => {
    setGuardando(true)
    setError('')
    try {
      if (!nombre.trim() || (directorioReal && !apellido.trim())) {
        throw new Error('Escribe el nombre y el apellido.')
      }
      if (!/.+@.+\..+/.test(email)) throw new Error('Escribe un correo válido.')
      if (directorioReal) {
        const problema = validarClave(clave, email)
        if (problema) throw new Error(problema.replace('La contraseña', 'La contraseña temporal'))
      }
      if (global && !empresaId) throw new Error('Selecciona la empresa de la persona.')
      const nombreCompleto = [nombre, directorioReal ? apellido : ''].filter(Boolean).join(' ').trim()
      const r = await repo.admin.usuarios.crear({
        nombre: nombreCompleto, email, rol, empresaId, conduce, clave,
        // La ruta «por empresa» (/tenants/:id/users) aún no está en el servidor publicado: si la empresa
        // elegida es la de la propia sesión se usa la ruta de siempre (/users), que sí existe.
        empresaDestinoId: global && empresaId !== actor?.empresaId ? empresaId : undefined,
      }, actor)
      await alGuardar()
      setCreado({ nombre: r.nombre, clave: r.clave, claveCreada: r.claveCreada !== false })
    } catch (e) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  const rolesReales = actor?.rol === 'admin_fom'
    ? [
        { v: 'supervisor', t: 'Supervisor' },
        { v: 'conductor', t: 'Conductor' },
        { v: 'usuario', t: 'Usuario' },
      ]
    : [
        { v: 'conductor', t: 'Conductor' },
        { v: 'usuario', t: 'Usuario' },
      ]

  return (
    <Modal titulo="Nuevo usuario" abierto={abierto} alCerrar={cerrar} ancho={520}>
      {directorioReal && !global && !creado && <p className="pnl-campo-ayuda">La cuenta se creará en {actor?.empresa || 'la empresa de tu sesión'}.</p>}
      {creado ? (
        <>
          {creado.clave ? (
            <p><b>{creado.nombre}</b> ya puede entrar con la clave <code>{creado.clave}</code>.</p>
          ) : (
            <p><b>{creado.nombre}</b> ya pertenecía al sistema y conserva su contraseña actual.</p>
          )}
          <p className="pnl-campo-ayuda">
            Entrégasela en persona: deberá cambiarla al entrar. No se volverá a mostrar.
          </p>
          <div className="pnl-chips">
            <button type="button" className="pnl-btn primario" onClick={cerrar}>
              Entendido
            </button>
          </div>
        </>
      ) : (
        <>
          <Campo etiqueta="Nombre" error={error}>
            <input type="text" className="pnl-input" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </Campo>
          {directorioReal && (
            <Campo etiqueta="Apellido">
              <input type="text" className="pnl-input" value={apellido} onChange={(e) => setApellido(e.target.value)} />
            </Campo>
          )}
          <Campo etiqueta="Correo">
            <input type="email" className="pnl-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="persona@empresa.com" />
          </Campo>
          {(!directorioReal || global) && <Campo etiqueta="Empresa">
            <select className="pnl-input" value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
              <option value="">Selecciona el empresa…</option>
              {destinos.map((e) => (
                <option key={e.id} value={e.id}>{e.nombre} · {e.tipoEtiqueta}</option>
              ))}
            </select>
          </Campo>}
          <Campo etiqueta="Rol" ayuda="Los roles disponibles dependen del tipo de empresa.">
            <select className="pnl-input" value={rol} onChange={(e) => setRol(e.target.value)}>
              {(directorioReal ? rolesReales : ROLES_ASIGNABLES.map((r) => ({ v: r, t: etiquetaRol(r, destino?.tipo) }))).map((r) => (
                <option key={r.v} value={r.v}>{r.t}</option>
              ))}
            </select>
          </Campo>
          {!directorioReal && <Campo etiqueta="Permisos">
            <label className="pnl-chip" style={{ display: 'inline-flex', gap: 8 }}>
              <input
                type="checkbox"
                checked={rol === 'conductor' ? true : conduce}
                disabled={rol === 'conductor'}
                onChange={(e) => setConduce(e.target.checked)}
              />
              Conduce vehículos
            </label>
          </Campo>}
          {directorioReal && (
            <Campo etiqueta="Contraseña temporal" ayuda={`${REGLAS_CLAVE} La persona deberá cambiarla al entrar.`}>
              <div className="pnl-chips">
                <input
                  type="text"
                  className="pnl-input"
                  value={clave}
                  onChange={(e) => setClave(e.target.value)}
                  autoComplete="new-password"
                />
                <button type="button" className="pnl-btn sutil" onClick={() => setClave(generarClaveTemporal())}>
                  Generar otra
                </button>
              </div>
            </Campo>
          )}

          <div className="pnl-chips">
            <button type="button" className="pnl-btn primario" onClick={confirmar} disabled={guardando}>
              <Icono nombre="check" tam={16} />
              {guardando ? 'Creando…' : 'Crear usuario'}
            </button>
            <button type="button" className="pnl-btn sutil" onClick={cerrar} disabled={guardando}>
              Cancelar
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

function ModalMover({ usuario, empresas, alCerrar, alGuardar, actor }) {
  const [empresaId, setEmpresaId] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  if (!usuario) return null
  const destinos = empresas.filter((e) => !e.respaldo && e.id !== usuario.empresaId)

  const cerrar = () => {
    setEmpresaId(''); setError('')
    alCerrar()
  }

  const confirmar = async () => {
    setGuardando(true)
    setError('')
    try {
      await repo.admin.usuarios.mover(usuario.id, empresaId, actor)
      await alGuardar()
      cerrar()
    } catch (e) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal titulo={`Mover a ${usuario.nombre}`} abierto alCerrar={cerrar} ancho={460}>
      <Campo etiqueta="Empresa destino" error={error} ayuda="El rol debe ser compatible con el tipo de empresa.">
        <select className="pnl-input" value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
          <option value="">Selecciona…</option>
          {destinos.map((e) => (
            <option key={e.id} value={e.id}>{e.nombre} · {e.tipoEtiqueta}</option>
          ))}
        </select>
      </Campo>
      <div className="pnl-chips">
        <button type="button" className="pnl-btn primario" onClick={confirmar} disabled={guardando || !empresaId}>
          <Icono nombre="check" tam={16} />
          {guardando ? 'Moviendo…' : 'Mover'}
        </button>
        <button type="button" className="pnl-btn sutil" onClick={cerrar} disabled={guardando}>
          Cancelar
        </button>
      </div>
    </Modal>
  )
}
