import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import repo from '../datos/repo'
import { useDatos } from '../useDatos'
import {
  Buscador, Cabecera, Campo, Cargando, Chips, ErrorCarga, Kpi, Modal, Tag, Tarjeta, Vacio,
} from '../comp/ui'
import { Barras } from '../comp/Grafico'
import * as f from '../datos/formato'
import { color, diasPara, etiqueta } from '../datos/catalogos'
import { Icono } from '../Iconos'
import FotosDe from '../comp/FotosDe'
import { GaleriaArchivos, SelectorArchivos } from '../comp/Archivos'
import { etiquetas, ids } from '../datos/cloudinary'
import { subirVarios } from '../datos/archivos'

// ============================================================
// DOCUMENTOS
// Vencimientos de vehículos y personas en un solo tablero: lo urgente arriba,
// el resto filtrable y exportable.
// ============================================================

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

// Marca de orden de bytes: sin ella Excel abre el CSV con los acentos rotos.
const BOM = String.fromCharCode(0xfeff)

/** Ruta del expediente del titular según el ámbito del documento. */
function rutaTitular(d) {
  if (!d.titularId) return null
  return d.ambito === 'vehiculo' ? `/panel/flota/${d.titularId}` : `/panel/personal/${d.titularId}`
}

const nombreAmbito = (ambito) => (ambito === 'vehiculo' ? 'Vehículo' : 'Personal')

/** Descarga la tabla filtrada como CSV, sin librerías. */
function exportarCsv(lista) {
  const cabeceras = ['Documento', 'Titular', 'Ámbito', 'Vence', 'Estado']
  const filas = lista.map((d) => [
    d.tipo,
    d.titular,
    nombreAmbito(d.ambito),
    d.venceEn,
    etiqueta('documento_estado', d.estado),
  ])
  const escapar = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const texto = [cabeceras, ...filas].map((fila) => fila.map(escapar).join(';')).join('\r\n')

  const blob = new Blob([BOM, texto], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = `documentos-${f.hoyISO()}.csv`
  document.body.appendChild(enlace)
  enlace.click()
  document.body.removeChild(enlace)
  URL.revokeObjectURL(url)
}

/** Vencimientos agrupados por mes, de este mes en adelante (6 meses). */
function vencimientosPorMes(lista) {
  const hoy = new Date()
  const meses = []
  for (let i = 0; i < 6; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1)
    meses.push({ anio: d.getFullYear(), mes: d.getMonth(), etiqueta: MESES[d.getMonth()], valor: 0 })
  }
  lista.forEach((doc) => {
    const v = new Date(`${doc.venceEn}T00:00:00`)
    const casilla = meses.find((m) => m.anio === v.getFullYear() && m.mes === v.getMonth())
    if (casilla) casilla.valor += 1
  })
  return meses.map((m) => ({ etiqueta: m.etiqueta, valor: m.valor }))
}

function cargar(ambito, estadoDoc, q) {
  return Promise.all([
    repo.documentos.listar({}),
    repo.documentos.listar({ ambito, estado: estadoDoc, q }),
  ]).then(([todos, lista]) => ({ todos, lista }))
}

export default function Documentos() {
  const [ambito, setAmbito] = useState('')
  const [estadoDoc, setEstadoDoc] = useState('')
  const [q, setQ] = useState('')
  const [renovando, setRenovando] = useState(null)
  const [creando, setCreando] = useState(false)
  const [aviso, setAviso] = useState('')

  const { datos, estado, error, recargar } = useDatos(() => cargar(ambito, estadoDoc, q), [ambito, estadoDoc, q])

  return (
    <>
      <Cabecera
        titulo="Documentos"
        bajada="Pólizas, certificados y licencias con su fecha de vencimiento al día."
      >
        <button
          type="button"
          className="pnl-btn"
          onClick={() => exportarCsv(datos?.lista ?? [])}
          disabled={estado !== 'ok' || (datos?.lista.length ?? 0) === 0}
        >
          <Icono nombre="descargar" tam={16} />
          Exportar CSV
        </button>
        <button type="button" className="pnl-btn primario" onClick={() => setCreando(true)}>
          <Icono nombre="mas" tam={16} />
          Registrar documento
        </button>
      </Cabecera>

      <div className="pnl-cuerpo">
        {aviso && <p className="pnl-campo-error" role="status">{aviso}</p>}
        {estado === 'cargando' && <Cargando filas={6} />}
        {estado === 'error' && <ErrorCarga onReintentar={recargar} error={error} />}
        {estado === 'ok' && (
          <Contenido
            datos={datos}
            ambito={ambito}
            setAmbito={setAmbito}
            estadoDoc={estadoDoc}
            setEstadoDoc={setEstadoDoc}
            q={q}
            setQ={setQ}
            abrirRenovar={setRenovando}
            archivar={async (d) => {
              setAviso('')
              try {
                await repo.documentos.archivar(d.id)
                setAviso(`${d.tipo} archivado: sale de la vigilancia y queda en el historial.`)
                await recargar()
              } catch (e) {
                setAviso(e?.message || 'No se pudo archivar.')
              }
            }}
          />
        )}
      </div>

      <ModalRenovar
        documento={renovando}
        alCerrar={() => setRenovando(null)}
        alGuardar={recargar}
      />
      <ModalNuevoDocumento abierto={creando} alCerrar={() => setCreando(false)} alGuardar={recargar} />
    </>
  )
}

function Contenido({ datos, ambito, setAmbito, estadoDoc, setEstadoDoc, q, setQ, abrirRenovar, archivar }) {
  const [fotosDe, setFotosDe] = useState(null)
  const [porArchivar, setPorArchivar] = useState(null)
  const verFotos = (d) => setFotosDe(d)
  const { todos, lista } = datos

  const vencidos = todos.filter((d) => d.estado === 'vencido').length
  const porVencer = todos.filter((d) => d.estado === 'por_vencer').length
  const vigentes = todos.filter((d) => d.estado === 'vigente').length

  const urgentes = useMemo(
    () => todos.filter((d) => d.estado === 'vencido' || diasPara(d.venceEn) <= 7).slice(0, 10),
    [todos]
  )
  const totalUrgentes = todos.filter((d) => d.estado === 'vencido' || diasPara(d.venceEn) <= 7).length
  const porMes = useMemo(() => vencimientosPorMes(todos), [todos])

  const cuentaAmbito = (a) => (a ? todos.filter((d) => d.ambito === a).length : todos.length)
  const cuentaEstado = (e) => (e ? todos.filter((d) => d.estado === e).length : todos.length)

  return (
    <>
      <div className="pnl-grid k4">
        <Kpi
          titulo="Vencidos"
          valor={f.numero(vencidos)}
          icono="alerta"
          tono={vencidos > 0 ? 'malo' : 'ok'}
          nota={vencidos > 0 ? 'Regularízalos cuanto antes' : 'Ninguno vencido'}
        />
        <Kpi
          titulo="Por vencer en 30 días"
          valor={f.numero(porVencer)}
          icono="reloj"
          tono={porVencer > 0 ? 'aviso' : 'ok'}
          nota={porVencer > 0 ? 'Programa la renovación' : 'Nada próximo a vencer'}
        />
        <Kpi
          titulo="Vigentes"
          valor={f.numero(vigentes)}
          icono="escudo"
          tono="ok"
          nota="Con más de 30 días de vigencia"
        />
        <Kpi
          titulo="Total"
          valor={f.numero(todos.length)}
          icono="documento"
          nota="Documentos bajo control"
        />
      </div>

      <div className="pnl-grid dos-tercios">
        <Tarjeta
          titulo="Atención inmediata"
          accion={
            totalUrgentes > urgentes.length ? (
              <span className="pnl-link">{totalUrgentes} en total</span>
            ) : null
          }
        >
          {urgentes.length === 0 ? (
            <Vacio
              icono="check"
              titulo="Nada urgente"
              texto="Ningún documento vence en los próximos 7 días."
            />
          ) : (
            <div className="pnl-filas">
              {urgentes.map((d) => {
                const ruta = rutaTitular(d)
                const clase = `pnl-fila ${d.estado === 'vencido' ? 'critica' : 'aviso'}`
                const contenido = (
                  <>
                    <div className="pnl-fila-txt">
                      <b>{d.tipo}</b>
                      <span>{d.titular} · {nombreAmbito(d.ambito)}</span>
                    </div>
                    <Tag color={color('documento_estado', d.estado)}>{f.vencimiento(d.venceEn)}</Tag>
                  </>
                )
                return ruta ? (
                  <Link key={d.id} to={ruta} className={clase}>{contenido}</Link>
                ) : (
                  <div key={d.id} className={clase}>{contenido}</div>
                )
              })}
            </div>
          )}
        </Tarjeta>

        <Tarjeta titulo="Vencimientos de los próximos 6 meses">
          <Barras datos={porMes} formato={(n) => f.numero(n)} />
        </Tarjeta>
      </div>

      <Tarjeta
        titulo="Todos los documentos"
        accion={<Buscador valor={q} alCambiar={setQ} placeholder="Buscar por tipo o titular…" />}
        sinCuerpo
      >
        <div className="pnl-card-cuerpo">
          <Chips
            opciones={[
              { v: '', t: 'Todos', n: cuentaAmbito('') },
              { v: 'vehiculo', t: 'De vehículos', n: cuentaAmbito('vehiculo') },
              { v: 'persona', t: 'De personal', n: cuentaAmbito('persona') },
            ]}
            valor={ambito}
            alCambiar={setAmbito}
          />
          <Chips
            opciones={[
              { v: '', t: 'Todos', n: cuentaEstado('') },
              { v: 'vencido', t: 'Vencidos', n: cuentaEstado('vencido') },
              { v: 'por_vencer', t: 'Por vencer', n: cuentaEstado('por_vencer') },
              { v: 'vigente', t: 'Vigentes', n: cuentaEstado('vigente') },
            ]}
            valor={estadoDoc}
            alCambiar={setEstadoDoc}
          />
        </div>

        {lista.length === 0 ? (
          <div className="pnl-card-cuerpo">
            <Vacio
              icono="buscar"
              titulo="No hay documentos que mostrar"
              texto="Prueba con otro filtro o limpia el buscador."
            />
          </div>
        ) : (
          <div className="pnl-tabla-wrap">
            <table className="pnl-tabla">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Titular</th>
                  <th>Ámbito</th>
                  <th>Vence</th>
                  <th>Estado</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {lista.map((d) => {
                  const ruta = rutaTitular(d)
                  return (
                    <tr key={d.id}>
                      <td>{d.tipo}</td>
                      <td>
                        {ruta ? (
                          <Link to={ruta} className="pnl-link">{d.titular}</Link>
                        ) : (
                          d.titular
                        )}
                      </td>
                      <td>{nombreAmbito(d.ambito)}</td>
                      <td>
                        <div className="pnl-doble">
                          <b>{f.fecha(d.venceEn)}</b>
                          <span>({f.vencimiento(d.venceEn)})</span>
                        </div>
                      </td>
                      <td>
                        <Tag color={color('documento_estado', d.estado)}>
                          {etiqueta('documento_estado', d.estado)}
                        </Tag>
                      </td>
                      <td className="num">
                        <div className="pnl-chips">
                          <button type="button" className="pnl-btn sutil" onClick={() => verFotos(d)}>
                            <Icono nombre="ver" tam={15} />
                            Fotos y PDF
                          </button>
                          <button type="button" className="pnl-btn sutil" onClick={() => abrirRenovar(d)}>
                            <Icono nombre="editar" tam={15} />
                            Renovar
                          </button>
                          <button type="button" className="pnl-btn sutil" onClick={() => setPorArchivar(d)}>
                            <Icono nombre="cerrar" tam={15} />
                            Archivar
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>
      <Modal titulo="¿Archivar este documento?" abierto={Boolean(porArchivar)} alCerrar={() => setPorArchivar(null)} ancho={460}>
        {porArchivar && (
          <>
            <p>{porArchivar.tipo} · {porArchivar.titular}. Sale de la vigilancia de vencimientos y queda en el historial.</p>
            <div className="pnl-chips">
              <button type="button" className="pnl-btn primario" onClick={() => { const d = porArchivar; setPorArchivar(null); archivar(d) }}>Archivar</button>
              <button type="button" className="pnl-btn sutil" onClick={() => setPorArchivar(null)}>Cancelar</button>
            </div>
          </>
        )}
      </Modal>
      <Modal titulo={fotosDe ? `Fotos y PDF: ${fotosDe.tipo}` : 'Fotos y PDF'} abierto={Boolean(fotosDe)} alCerrar={() => setFotosDe(null)} ancho={760}>
        {fotosDe && <ArchivosDeDocumento documento={fotosDe} />}
      </Modal>
    </>
  )
}

function ModalRenovar({ documento, alCerrar, alGuardar }) {
  const [fecha, setFecha] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  if (!documento) return null

  const cerrar = () => {
    setFecha('')
    setError('')
    alCerrar()
  }

  const confirmar = async () => {
    if (!fecha || fecha <= f.hoyISO()) {
      setError('La nueva fecha debe ser posterior a hoy.')
      return
    }
    setGuardando(true)
    try {
      await repo.documentos.actualizarVencimiento(documento.id, fecha)
      await alGuardar()
      cerrar()
    } catch {
      setError('No pudimos guardar el cambio. Inténtalo de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal titulo={`Renovar ${documento.tipo}`} abierto alCerrar={cerrar} ancho={460}>
      <Campo
        etiqueta="Nueva fecha de vencimiento"
        error={error}
        ayuda={`${documento.titular} · ${f.vencimiento(documento.venceEn)}`}
      >
        <input
          type="date"
          className="pnl-input"
          value={fecha}
          min={f.hoyISO()}
          onChange={(e) => {
            setFecha(e.target.value)
            setError('')
          }}
        />
      </Campo>

      <div className="pnl-chips">
        <button type="button" className="pnl-btn primario" onClick={confirmar} disabled={guardando}>
          <Icono nombre="check" tam={16} />
          {guardando ? 'Guardando…' : 'Guardar vencimiento'}
        </button>
        <button type="button" className="pnl-btn sutil" onClick={cerrar} disabled={guardando}>
          Cancelar
        </button>
      </div>
    </Modal>
  )
}

// ---------------- Registrar un documento ----------------
// Mismo alta que en la app: ámbito (unidad o persona), tipo con código
// estable, número, emisión y vencimiento. El PDF se sube aparte (todavía
// sin ruta en el panel); aquí queda el registro que dispara los avisos.

const TIPOS_SUGERIDOS = [
  ['seguro_rcv', 'Seguro RCV'],
  ['poliza_casco', 'Póliza de casco'],
  ['certificado_gas', 'Certificado de gas'],
  ['permiso_circulacion', 'Permiso de circulación'],
  ['revision_tecnica', 'Revisión técnica'],
  ['certificado_medico', 'Certificado médico'],
  ['licencia_conducir', 'Licencia de conducir'],
]
const PATRON_TIPO = /^[a-z][a-z0-9_]{1,59}$/u

/** Las dos caras del documento (frente y reverso) y los demás archivos: fotos o el PDF. */
export function ArchivosDeDocumento({ documento }) {
  return (
    <div className="pnl-filas">
      <FotosDe huecos={[
        { clave: 'frente', titulo: 'Frente', publicId: ids.documento(documento.id, 'frente'), etiqueta: etiquetas.documento(documento.id) },
        { clave: 'reverso', titulo: 'Reverso', publicId: ids.documento(documento.id, 'reverso'), etiqueta: etiquetas.documento(documento.id) },
      ]} />
      <div className="arch-bloque">
        <GaleriaArchivos coleccion="documents" padreId={documento.id} proposito="document_file" titulo="Otros archivos (PDF o fotos)" vacio="Sin archivos: sube aquí la póliza en PDF o más fotos." />
      </div>
    </div>
  )
}

const VACIO_DOC = { ambito: 'vehiculo', vehiculoId: '', personaId: '', tipo: '', numero: '', emitidoEn: '', venceEn: '', notas: '' }

/**
 * Registrar un documento. Con `fijo` ({ ambito, vehiculoId | personaId, nombre }) ya se sabe de quién es
 * (por ejemplo desde la ficha de una unidad) y no se pregunta.
 */
export function ModalNuevoDocumento({ abierto, alCerrar, alGuardar, fijo = null }) {
  const inicial = fijo ? { ...VACIO_DOC, ambito: fijo.ambito, vehiculoId: fijo.vehiculoId ?? '', personaId: fijo.personaId ?? '' } : VACIO_DOC
  const [d, setD] = useState(inicial)
  const [error, setError] = useState({})
  const [guardando, setGuardando] = useState(false)
  const [archivos, setArchivos] = useState([])
  const vehiculos = useDatos(() => repo.vehiculos.listar({}), [])
  const gente = useDatos(() => repo.admin.usuarios.listar({}), [])
  const set = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.value }))

  const cerrar = () => {
    setError({})
    setArchivos([])
    alCerrar()
  }

  async function confirmar() {
    const err = {}
    const tipo = d.tipo.trim().toLowerCase().replace(/\s+/gu, '_')
    if (d.ambito === 'vehiculo' && !d.vehiculoId) err.sujeto = 'Elige la unidad.'
    if (d.ambito === 'persona' && !d.personaId) err.sujeto = 'Elige la persona.'
    if (!PATRON_TIPO.test(tipo)) err.tipo = 'Un código corto en minúsculas, sin espacios: seguro_rcv, permiso_circulacion…'
    if (!d.venceEn) err.venceEn = 'Di cuándo vence: es lo que dispara los avisos.'
    if (d.emitidoEn && d.venceEn && d.emitidoEn > d.venceEn) err.venceEn = 'No puede vencer antes de emitirse.'
    setError(err)
    if (Object.keys(err).length > 0) return
    setGuardando(true)
    try {
      const creado = await repo.documentos.crear({
        ambito: d.ambito,
        vehiculoId: d.ambito === 'vehiculo' ? d.vehiculoId : undefined,
        personaId: d.ambito === 'persona' ? d.personaId : undefined,
        tipo,
        numero: d.numero.trim(),
        emitidoEn: d.emitidoEn,
        venceEn: d.venceEn,
        notas: d.notas.trim(),
      })
      // Los archivos van después: necesitan el número del documento para quedar unidos a él.
      const docId = typeof creado === 'string' ? creado : creado?.id
      if (archivos.length && docId) {
        const r = await subirVarios({ coleccion: 'documents', padreId: docId, proposito: 'document_file', archivos })
        if (r.errores.length) {
          await alGuardar()
          setError({ general: `El documento quedó registrado, pero ${r.errores.length} archivo(s) no se subieron: ${r.errores[0]} Puedes subirlos desde «Fotos y PDF».` })
          setArchivos([])
          return
        }
      }
      await alGuardar()
      setD(inicial)
      cerrar()
    } catch (e) {
      setError({ general: e?.message || 'No pudimos registrar el documento.' })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal titulo="Registrar documento" abierto={abierto} alCerrar={cerrar} ancho={560}>
      {fijo ? (
        <Campo etiqueta="De quién es">
          <p className="pnl-campo-fijo"><b>{fijo.nombre}</b></p>
        </Campo>
      ) : (
      <Campo etiqueta="De quién es" error={error.sujeto}>
        <div className="pnl-chips">
          <select className="pnl-input" value={d.ambito} onChange={set('ambito')} aria-label="Ámbito">
            <option value="vehiculo">De una unidad</option>
            <option value="persona">De una persona</option>
          </select>
          {d.ambito === 'vehiculo' ? (
            <select className="pnl-input" value={d.vehiculoId} onChange={set('vehiculoId')} aria-label="Unidad">
              <option value="">Elige la unidad…</option>
              {(vehiculos.datos ?? []).map((v) => <option key={v.id} value={v.id}>{v.alias} · {v.placa}</option>)}
            </select>
          ) : (
            <select className="pnl-input" value={d.personaId} onChange={set('personaId')} aria-label="Persona">
              <option value="">Elige la persona…</option>
              {(gente.datos ?? []).map((p) => <option key={p.id} value={p.userId ?? p.id}>{p.nombre}</option>)}
            </select>
          )}
        </div>
      </Campo>
      )}
      <Campo etiqueta="Tipo de documento" error={error.tipo} ayuda="Código estable del tipo dentro de tu empresa. Elige uno sugerido o escribe el tuyo.">
        <input className="pnl-input" list="tipos-de-documento" value={d.tipo} onChange={set('tipo')} placeholder="seguro_rcv" />
        <datalist id="tipos-de-documento">
          {TIPOS_SUGERIDOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </datalist>
      </Campo>
      <Campo etiqueta="Número (opcional)">
        <input className="pnl-input" value={d.numero} onChange={set('numero')} />
      </Campo>
      <div className="pnl-grid k2">
        <Campo etiqueta="Emitido el (opcional)">
          <input type="date" className="pnl-input" value={d.emitidoEn} onChange={set('emitidoEn')} />
        </Campo>
        <Campo etiqueta="Vence el" error={error.venceEn}>
          <input type="date" className="pnl-input" value={d.venceEn} onChange={set('venceEn')} />
        </Campo>
      </div>
      <Campo etiqueta="Notas (opcional)">
        <input className="pnl-input" value={d.notas} onChange={set('notas')} />
      </Campo>
      <SelectorArchivos
        archivos={archivos}
        alCambiar={setArchivos}
        coleccion="documents"
        aceptaPdf
        titulo="Fotos o PDF del documento (opcional)"
        ayuda="La póliza en PDF, o fotos del frente y del reverso. Se suben al registrarlo."
        deshabilitado={guardando}
      />
      {error.general && <p className="pnl-campo-error" role="alert">{error.general}</p>}
      <div className="pnl-chips">
        <button type="button" className="pnl-btn primario" onClick={confirmar} disabled={guardando}>
          <Icono nombre="check" tam={16} />
          {guardando ? 'Guardando…' : 'Registrar'}
        </button>
        <button type="button" className="pnl-btn sutil" onClick={cerrar} disabled={guardando}>
          Cancelar
        </button>
      </div>
    </Modal>
  )
}
