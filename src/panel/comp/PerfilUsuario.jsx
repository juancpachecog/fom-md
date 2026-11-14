import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import repo from '../datos/repo'
import { Campo, Datos, Kpi, Modal, Tag, Tarjeta, Vacio } from './ui'
import ManejoConductor from './ManejoConductor'
import { eventosManejo } from '../datos/manejo'
import * as f from '../datos/formato'
import { masNuevoPrimero } from '../datos/orden'
import { color, estadoDocumento, etiqueta } from '../datos/catalogos'
import { Icono } from '../Iconos'
import { etiquetaRolSesion, rolCanonico } from '../roles'
import { useSesion } from '../useSesion'
import EventosManejoPerfil from './ManejoBrusco'
import { enlaceEventoEnMapa } from '../datos/eventosManejo'
import { cambiosDatosUsuario, indiceDePersona, nombreDocumentoUsuario } from '../datos/perfilUsuario'
import FotoUnidad from './FotoUnidad'
import CredencialesPersona from './CredencialesPersona'
import Avatar from './Avatar'
import FotosIdentidad from './FotosIdentidad'
import CambiarFoto from './CambiarFoto'
import { etiquetas as etiquetasFoto, ids as idsFoto } from '../datos/cloudinary'
import '../modulos/usuarios-perfil.css'
import { useConfirmar } from './Confirmar'

export const PESTANAS = [
  { v: 'datos', t: 'Datos' },
  { v: 'conduccion', t: 'Conducción' },
  { v: 'inspecciones', t: 'Inspecciones' },
  { v: 'documentos', t: 'Documentos' },
]

function PestanasPerfil({ valor, alCambiar, opciones = PESTANAS }) {
  return <div className="pnl-tabs usr-tabs" role="tablist" aria-label="Información del usuario" onKeyDown={e => {
    const actual = opciones.findIndex(t => t.v === valor)
    const siguiente = e.key === 'ArrowRight' ? (actual + 1) % opciones.length
      : e.key === 'ArrowLeft' ? (actual + opciones.length - 1) % opciones.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? opciones.length - 1 : null
    if (siguiente === null) return
    e.preventDefault()
    alCambiar(opciones[siguiente].v)
    e.currentTarget.querySelectorAll('[role="tab"]')[siguiente]?.focus()
  }}>
    {opciones.map(t => <button key={t.v} type="button" role="tab" id={`usr-tab-${t.v}`}
      aria-selected={valor === t.v} aria-controls={`usr-panel-${t.v}`} tabIndex={valor === t.v ? 0 : -1}
      className={`pnl-tab${valor === t.v ? ' activo' : ''}`} onClick={() => alCambiar(t.v)}>{t.t}</button>)}
  </div>
}

function Identidad({ persona: p, avatar, acciones }) {
  return (
    <Tarjeta>
      <div className="pnl-persona usr-identidad">
        {avatar || <i className="pnl-avatar-l">{f.iniciales(p.nombre)}</i>}
        <div className="pnl-fila-txt">
          <b>{p.nombre}</b>
          <span>{p.email}</span>
          <span>
            <Icono nombre="llamar" tam={14} />
            {` ${p.telefono || 'Sin teléfono'}`}
          </span>
        </div>
        <Tag color={p.rol === 'conductor' ? 'azul' : 'gris'}>{etiquetaRolSesion(p.rol)}</Tag>
        {acciones}
      </div>
    </Tarjeta>
  )
}

/** Fecha con su cuenta regresiva y el color del semáforo de documentos. */
function Vence({ iso }) {
  if (!iso) return <>Sin registro</>
  const estado = estadoDocumento(iso)
  return (
    <>
      {`${f.fecha(iso)} `}
      <Tag color={color('documento_estado', estado)} plano>{f.vencimiento(iso)}</Tag>
    </>
  )
}

function FichaDatos({ persona: p }) {
  const licencia = p.licenciaNumero
    ? [p.licenciaNumero, p.licenciaCategoria ? `Grado ${p.licenciaCategoria}` : null].filter(Boolean).join(' · ')
    : 'Sin licencia cargada'

  return (
    <Tarjeta
      titulo="Datos de la persona"
      accion={
        p.perfilCompleto ? (
          <Tag color="verde">Perfil completo</Tag>
        ) : (
          <Tag color="ambar">Perfil sin completar</Tag>
        )
      }
    >
      {!p.perfilCompleto && (
        <div className="pnl-fila aviso">
          <i className="pnl-punto off" />
          <div className="pnl-fila-txt">
            <b>Perfil sin completar</b>
            <span>
              Completa los datos personales. La licencia y el certificado médico se consultan en Documentos.
            </span>
          </div>
        </div>
      )}

      <Datos
        items={[
          { etiqueta: 'Nombre', valor: p.nombre },
          { etiqueta: 'Cédula', valor: p.cedula || 'Sin registro' },
          { etiqueta: 'Correo', valor: p.email },
          { etiqueta: 'Teléfono', valor: p.telefono || 'Sin registro' },
          { etiqueta: 'Dirección', valor: p.direccion || 'Sin registro' },
          { etiqueta: 'Fecha de nacimiento', valor: p.fechaNacimiento ? f.fecha(p.fechaNacimiento) : 'Sin registro' },
          { etiqueta: 'Rol', valor: etiquetaRolSesion(p.rol) },
          { etiqueta: 'Licencia', valor: licencia },
          { etiqueta: 'Vence la licencia', valor: <Vence iso={p.licenciaVence} /> },
          { etiqueta: 'Certificado médico', valor: <Vence iso={p.cartaMedicaVence} /> },
          { etiqueta: 'Perfil completo', valor: p.perfilCompleto ? 'Sí' : 'No' },
          { etiqueta: 'Alta en el sistema', valor: f.fecha(p.creadoEn) },
        ]}
      />
    </Tarjeta>
  )
}

function UnidadAsignada({ persona: p, unidadActual, puedeEditar, unidades, cargandoFlota, guardado, alAsignar, alQuitar }) {
  const [elegida, setElegida] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setElegida(''); setError('') }, [p.id])
  const guardar = async (quitar = false) => {
    if (ocupado || (!quitar && !elegida)) return
    setOcupado(true)
    setError('')
    try {
      if (quitar) await alQuitar()
      else await alAsignar(elegida)
      setElegida('')
    } catch (e) { setError(e.message || 'No se pudo guardar la asignación.') }
    finally { setOcupado(false) }
  }
  return (
    <Tarjeta
      titulo="Unidad asignada"
      accion={guardado ? <Tag color="verde">Guardado</Tag> : null}
    >
      <div className="usr-unidad">
      {p.unidad && <FotoUnidad unidad={unidadActual} />}
      <div className="pnl-filas">
        {p.unidad ? (
          <div className="pnl-fila">
            <i className="pnl-punto on" />
            <div className="pnl-fila-txt">
              <b>{p.unidad.alias}</b>
              <span>{p.unidad.placa || 'Sin placa'}</span>
            </div>
            <Link to={`/panel/flota/${p.unidad.id}`} className="pnl-link">
              Ver la unidad
            </Link>
          </div>
        ) : (
          <div className="pnl-fila">
            <i className="pnl-punto off" />
            <div className="pnl-fila-txt">
              <b>Sin unidad asignada</b>
              <span>Esta persona no maneja ninguna unidad de la flota.</span>
            </div>
          </div>
        )}
      </div>

      {puedeEditar && <Campo
        etiqueta={p.unidad ? 'Cambiar de unidad' : 'Asignar una unidad'}
        ayuda="Elige una unidad y pulsa Asignar para guardar el cambio."
        error={error}
      >
        <select
          className="pnl-select"
          value={elegida}
          disabled={ocupado || cargandoFlota || unidades.length === 0}
          onChange={(e) => { setElegida(e.target.value); setError('') }}
        >
          <option value="">
            {cargandoFlota ? 'Cargando la flota…' : 'Elegir una unidad…'}
          </option>
          {unidades.map((v) => (
            <option key={v.id} value={v.id}>
              {v.conductorPrincipalId
                ? `${v.alias} · ${v.placa} (la maneja ${v.conductorNombre})`
                : `${v.alias} · ${v.placa} (libre)`}
            </option>
          ))}
        </select>
        {elegida && elegida !== p.unidad?.id && (
          <div className="pnl-chips">
            <button type="button" className="pnl-btn primario" disabled={ocupado} onClick={() => guardar()}>{ocupado ? 'Asignando…' : 'Asignar'}</button>
            <button type="button" className="pnl-btn sutil" disabled={ocupado} onClick={() => { setElegida(''); setError('') }}>Cancelar</button>
          </div>
        )}
      </Campo>}

      {p.unidad && puedeEditar && (
        <button type="button" className="pnl-btn sutil" disabled={ocupado} onClick={() => guardar(true)}>
          <Icono nombre="cerrar" tam={16} />
          Quitar asignación
        </button>
      )}
      </div>
    </Tarjeta>
  )
}

/**
 * Pestaña Conducción: la lista de frenadas, aceleraciones y excesos de más de 120 km/h (sin
 * mapa: cada evento lleva al Centro de control con el mapa en él). Mi perfil (el conductor en
 * sesión) los lee por `me/`; la ficha que mira el supervisor, por la persona.
 */
function Conduccion({ persona: p }) {
  const sesion = useSesion()
  const id = p.userId ?? p.id
  const propio = Boolean(id) && sesion?.perfil?.id === id && rolCanonico(sesion?.perfil?.rol) === 'conductor'
  return <EventosManejoPerfil key={`${id}:${propio}`} userId={id} propio={propio} />
}

function Inspecciones({ inspecciones, error }) {
  if (inspecciones.length === 0) {
    return (
      <Tarjeta titulo="Inspecciones">
        <Vacio
          icono="check"
          titulo={error ? 'Inspecciones no disponibles' : 'Sin inspecciones'}
          texto={error || 'Esta persona todavía no ha firmado ninguna inspección preoperacional.'}
        />
      </Tarjeta>
    )
  }

  return (
    <Tarjeta titulo="Inspecciones preoperacionales" sinCuerpo>
      {error && <p className="usr-nota" role="status">{error}</p>}
      <div className="pnl-tabla-wrap">
        <table className="pnl-tabla">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Resultado</th>
              <th className="num">Observaciones</th>
              <th className="num">Fallas críticas</th>
            </tr>
          </thead>
          <tbody>
            {masNuevoPrimero(inspecciones, ['creadaEn', 'fecha']).map((i) => (
              <tr key={i.id}>
                <td>{f.fecha(i.fecha)}</td>
                <td>
                  <Tag color={color('inspeccion_resultado', i.resultado)}>
                    {etiqueta('inspeccion_resultado', i.resultado)}
                  </Tag>
                </td>
                <td className="num">{i.observaciones == null ? 'Sin dato' : f.numero(i.observaciones)}</td>
                <td className="num">
                  {i.fallasCriticas > 0 ? (
                    <Tag color="rojo">{f.numero(i.fallasCriticas)}</Tag>
                  ) : (
                    i.fallasCriticas == null ? 'Sin dato' : f.numero(i.fallasCriticas)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Tarjeta>
  )
}

function Documentos({ persona, alActualizar, ...props }) {
  return <div className="pnl-grid">
    {persona && <CredencialesPersona persona={persona} alActualizar={alActualizar} />}
    {persona && (persona.userId ?? persona.id) && <Tarjeta titulo="Fotos de sus documentos">
      <FotosIdentidad userId={persona.userId ?? persona.id} conduce={Boolean(persona.conduce || persona.unidad)} />
    </Tarjeta>}
    <TablaDocumentos {...props} />
  </div>
}

function TablaDocumentos({ documentos, error, alVer }) {
  if (documentos.length === 0) {
    return (
      <Tarjeta titulo="Documentos">
        <Vacio
          icono="documento"
          titulo={error ? 'Documentos no disponibles' : 'Sin documentos cargados'}
          texto={error || 'Cuando suba su licencia, su cédula o su certificado médico, van a aparecer aquí.'}
        />
      </Tarjeta>
    )
  }

  return (
    <Tarjeta titulo="Documentos de la persona" sinCuerpo>
      {error && <p className="usr-nota" role="status">{error}</p>}
      <div className="pnl-tabla-wrap">
        <table className="pnl-tabla">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Vence</th>
              <th>Estado</th>
              {alVer && <th>Acción</th>}
            </tr>
          </thead>
          <tbody>
            {documentos.map((d) => (
              <tr key={d.id}>
                <td>{nombreDocumentoUsuario(d.tipo)}{d.numero && <small className="usr-doc-numero">{d.numero}</small>}</td>
                <td>{d.venceEn ? `${f.fecha(d.venceEn)} (${f.vencimiento(d.venceEn)})` : 'Sin fecha registrada'}</td>
                <td>
                  <Tag color={d.venceEn ? color('documento_estado', d.estado) : 'gris'}>
                    {d.venceEn ? etiqueta('documento_estado', d.estado) : 'Sin vencimiento registrado'}
                  </Tag>
                </td>
                {alVer && <td><button type="button" className="pnl-btn sutil" onClick={() => alVer(d)} aria-label={`Ver información de ${nombreDocumentoUsuario(d.tipo)}`}>Ver información</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Tarjeta>
  )
}

// ---------------- Completar el perfil ----------------
// Los cuatro datos que la app pide para dar el perfil por completo: cédula,
// teléfono, dirección y fecha de nacimiento. El servidor exige formatos
// (`v-12345678`, `+58414…`); el repositorio los normaliza antes de enviar.
function ModalPerfil({ persona: p, alCerrar, alHecho }) {
  const { confirmar: pedirConfirmacion, dialogo } = useConfirmar()
  const [d, setD] = useState({ nombre: p.nombre ?? '', cedula: p.cedula ?? '', telefono: p.telefono ?? '', direccion: p.direccion ?? '', nacimiento: p.fechaNacimiento ?? '' })
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const set = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.value }))
  async function confirmar() {
    if (guardando) return
    setGuardando(true)
    setError('')
    try {
      const cambios = cambiosDatosUsuario(d, p)
      if (Object.keys(cambios).length && !await pedirConfirmacion({ titulo: 'Guardar datos del usuario', texto: `¿Guardar los cambios de ${p.nombre}?`, accion: 'Guardar datos' })) return
      if (Object.keys(cambios).length) await repo.personal.actualizarPerfil(p.userId ?? p.id, cambios)
      alHecho()
    } catch (e) {
      setError(e?.message || 'No se pudo guardar el perfil.')
    } finally {
      setGuardando(false)
    }
  }
  return (
    <><Modal titulo="Editar datos" abierto alCerrar={() => !guardando && alCerrar()} ancho={520}>
      <fieldset className="usr-editar" disabled={guardando} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      {/* La foto de perfil se guarda en la misma dirección que usa «Configuración» (fom/avatar/<userId>). */}
      <div className="usr-editar-identidad">
        <Avatar userId={p.userId ?? p.id} iniciales={f.iniciales(p.nombre)} nombre={p.nombre} clase="pnl-avatar-l" tam={128} />
        <div>
          <b>{p.nombre}</b>
          <p>{etiquetaRolSesion(p.rol)}</p>
          {(p.userId ?? p.id) && (
            <CambiarFoto flotante={false} publicId={idsFoto.avatar(p.userId ?? p.id)} etiqueta={etiquetasFoto.avatar(p.userId ?? p.id)}
              titulo={`Foto de perfil de ${p.nombre}`} textos={{ subir: 'Subir o cambiar foto' }} />
          )}
        </div>
      </div>
      <p className="usr-editar-ayuda">Completa los datos del perfil.</p>
        <Campo etiqueta="Nombre"><input className="pnl-input" value={d.nombre} maxLength={120} disabled={guardando} onChange={set('nombre')} /></Campo>
        <Campo etiqueta="Cédula" ayuda="V12345678 o E-1234567">
          <input className="pnl-input" value={d.cedula} onChange={set('cedula')} placeholder="V12345678" />
        </Campo>
        <Campo etiqueta="Teléfono" ayuda="0414-1234567 o +584141234567">
          <input className="pnl-input" value={d.telefono} onChange={set('telefono')} placeholder="0414-1234567" />
        </Campo>
      <Campo etiqueta="Dirección">
        <input className="pnl-input" value={d.direccion} onChange={set('direccion')} />
      </Campo>
      <Campo etiqueta="Fecha de nacimiento" error={error}>
        <input type="date" className="pnl-input" value={d.nacimiento} onChange={set('nacimiento')} />
      </Campo>
      {(p.userId ?? p.id) && <div className="usr-editar-fotos">
        <b>Fotos de sus documentos</b>
        <p className="usr-editar-ayuda">Se guardan al subirlas, sin esperar a «Guardar datos».</p>
        <FotosIdentidad userId={p.userId ?? p.id} conduce={Boolean(p.conduce || p.unidad || p.rol === 'conductor')} />
      </div>}
      <div className="usr-editar-acciones">
        <button type="button" className="pnl-btn sutil" onClick={alCerrar} disabled={guardando}>Cancelar</button>
        <button type="button" className="pnl-btn primario" onClick={confirmar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar datos'}
        </button>
      </div>
      </fieldset>
    </Modal>{dialogo}</>
  )
}

export { PestanasPerfil, Identidad, FichaDatos, UnidadAsignada, Conduccion, Inspecciones, Documentos, ModalPerfil }

/**
 * Cabecera de cifras de una persona. La tarjeta «Manejo» solo sale si la persona conduce; `propio` lee
 * el score de la sesión (Mi perfil) y si no, el del ranking de la empresa (ficha que mira el supervisor).
 */
export function MetricasPerfil({ persona: p, propio = false }) {
  const indice = indiceDePersona({ indice: p?.indiceSeguro })
  const eventos = p?.eventos ?? []
  const inspecciones = p?.inspecciones ?? []
  const odts = p?.odts ?? []
  const score = p?.manejo
  const conduce = Boolean(p?.conduce || p?.unidad || p?.rol === 'conductor')
  const delPeriodo = eventosManejo(score)
  const totalEventos = delPeriodo !== null ? delPeriodo
    : p?.eventosDisponibles === false ? null : eventos.length
  // Lo que la ficha ya leyó (7 días) abre la tarjeta sin otra consulta. En la semilla solo existe el índice de la unidad.
  const inicial = score ?? (indice !== null ? { indice } : null)
  // «Ver eventos →» lleva al mapa con su unidad elegida (sus eventos en el mapa); sin unidad, a la lista.
  const enlaceEventos = p?.unidad?.id ? enlaceEventoEnMapa({ vehiculoId: p.unidad.id, conductorId: propio ? null : p.userId ?? p.id }) : '?vista=conduccion'
  return (
  <>
  {conduce && <ManejoConductor
    userId={p.userId ?? p.id}
    propio={propio}
    inicial={inicial}
    diasInicial={7}
    cargandoInicial={Boolean(p.manejoCargando)}
    empresa={p.empresaNombre || p.empresa}
    logoEmpresa={p.logoEmpresa}
    error={p.manejoError}
    enlaceEventos={enlaceEventos}
    nota={p.indiceFuente !== 'conductor' && !p.manejo
      ? `Índice de la unidad asignada${p.unidad ? ` · ${p.unidad.alias} · ${p.unidad.placa}` : ''}`
      : undefined}
  />}
  <div className="pnl-grid k3">
    <Kpi
      titulo="Eventos de manejo"
      valor={totalEventos === null ? 'Sin dato' : f.numero(totalEventos)}
      icono="alerta"
      tono={totalEventos > 8 ? 'aviso' : ''}
      nota={`en los últimos ${score?.dias ?? 7} días`}
      a={conduce ? enlaceEventos : undefined}
    />
    <Kpi
      titulo="Inspecciones hechas"
      valor={p.inspeccionesDisponibles === false ? 'Sin dato' : f.numero(inspecciones.length)}
      icono="check"
                nota={p.inspeccionesDisponibles === false ? 'no se puede confirmar el total' : 'preoperacionales firmadas'}
    />
    <Kpi
      titulo="ODT reportadas"
      valor={p.odtsDisponibles === false ? 'Sin dato' : f.numero(odts.length)}
      icono="llave"
                nota={p.odtsDisponibles === false ? 'no se puede confirmar el total' : 'órdenes que abrió esta persona'}
    />
  </div>
  </>
  )
}
