import { useEffect, useState } from 'react'
import { useSesion } from '../useSesion'
import { Icono } from '../Iconos'
import { Cabecera, Campo, Cargando, Datos, ErrorCarga, Modal, Tag, Tarjeta, Vacio } from '../comp/ui'
import { cargarMiPerfil, guardarMiPerfil } from '../datos/miPerfil'
import { iniciales, fecha } from '../datos/formato'
import './perfil-alertas.css'
import Apariencia from '../comp/Apariencia'
import Avatar from '../comp/Avatar'
import EditarMisDatos from '../comp/EditarMisDatos'
import FotosDe from '../comp/FotosDe'
import { claveDeTipo, huecosPersona } from '../comp/FotosIdentidad'
import { ArchivosDeDocumento } from './Documentos'
import CambiarFoto from '../comp/CambiarFoto'
import { cloudinaryConfigurado, etiquetas, ids } from '../datos/cloudinary'
import ScoreManejo from '../comp/ScoreManejo'

const ESTADOS = { vigente: ['Vigente', 'verde'], por_vencer: ['Por vencer', 'ambar'], vencido: ['Vencido', 'rojo'] }
const CAMPOS = [['nombre', 'Nombre y apellido', 'text'], ['cedula', 'Cédula', 'text'], ['telefono', 'Teléfono', 'tel'], ['direccion', 'Dirección', 'text'], ['fechaNacimiento', 'Fecha de nacimiento', 'date']]

/** Botón para cambiar la foto de perfil: reemplaza la anterior (misma dirección fija en Cloudinary). */
function FotoDePerfil({ userId }) {
  if (!userId) return null
  if (!cloudinaryConfigurado()) return <p className="fp-foto-nota">La foto de perfil se activa cuando se conecte Cloudinary a esta web.</p>
  return (
    <div className="fp-foto-nota">
      <CambiarFoto flotante={false} publicId={ids.avatar(userId)} etiqueta={etiquetas.avatar(userId)} titulo="Foto de perfil" hayFoto textos={{ editar: 'Cambiar foto' }} />
    </div>
  )
}

export default function MiPerfil() {
  const sesion = useSesion()
  return <Perfil key={sesion?.perfil.correo || sesion?.perfil.id} />
}

function Perfil() {
  const [perfil, setPerfil] = useState(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(true)
  const [revision, setRevision] = useState(0)
  const [editando, setEditando] = useState(false)
  const [borrador, setBorrador] = useState({})
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState('')
  const [documento, setDocumento] = useState(null)
  const [seguridad, setSeguridad] = useState(false)

  useEffect(() => {
    let vivo = true
    setCargando(true)
    setError('')
    cargarMiPerfil().then(p => { if (vivo) setPerfil(p) }).catch(e => { if (vivo) setError(e.message) }).finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [revision])

  function editar() {
    setBorrador(Object.fromEntries(CAMPOS.map(([clave]) => [clave, perfil[clave] || ''])))
    setAviso('')
    setError('')
    setEditando(true)
  }
  async function guardar(e) {
    e.preventDefault()
    if (guardando) return
    setGuardando(true)
    setError('')
    try {
      const nuevo = await guardarMiPerfil(borrador, perfil)
      setPerfil(nuevo)
      setEditando(false)
      setAviso('Tus datos se guardaron correctamente.')
    } catch (e) { setError(e.message) }
    finally { setGuardando(false) }
  }
  function cancelar() { if (!guardando) { setEditando(false); setError('') } }

  const documentos = [...(perfil?.documentos ?? [])]
  if (perfil?.cedula && !documentos.some(d => /c[eé]dula|identidad/i.test(d.tipo))) documentos.unshift({ tipo: 'Cédula de identidad', numero: perfil.cedula, declarado: true })
  if (perfil?.conduce && perfil.licenciaNumero && !documentos.some(d => /licencia/i.test(d.tipo))) documentos.push({ tipo: 'Licencia de conducir', numero: perfil.licenciaNumero, venceEn: perfil.licenciaVence, declarado: true })
  if (perfil?.conduce && perfil.cartaMedicaVence && !documentos.some(d => /m[eé]dic/i.test(d.tipo))) documentos.push({ tipo: 'Carta médica', venceEn: perfil.cartaMedicaVence, declarado: true })
  const valor = (v, disponible = true) => v || (disponible ? 'Sin registrar' : 'Se completa desde la app')
  const campos = perfil ? [
    ['gente', 'Nombre y apellido', perfil.nombre],
    ['documento', 'Cédula', valor(perfil.cedula, perfil.editable || perfil.completoDisponible)],
    ['llamar', 'Teléfono', valor(perfil.telefono, perfil.editable || perfil.completoDisponible)],
    ['pin', 'Dirección', valor(perfil.direccion, perfil.completoDisponible)],
    ['reloj', 'Fecha de nacimiento', perfil.fechaNacimiento ? fecha(perfil.fechaNacimiento) : valor(null, perfil.completoDisponible)],
    ['info', 'Correo de acceso', perfil.email],
  ] : []

  return <div className="fp-superficie pa-superficie">
    <Cabecera titulo="Mi perfil" bajada="Tus datos, documentos y acceso a FOM.">
      {perfil?.editable && !cargando && <button className="pnl-btn primario" onClick={editar}><Icono nombre="editar" tam={18} />Editar mis datos</button>}
    </Cabecera>
    <div className="pnl-cuerpo">
      {perfil?.conduce && <ScoreManejo titulo="Mi score de manejo" />}
      <Apariencia />
      {cargando ? <Cargando filas={4} /> : !perfil ? <ErrorCarga error={{ message: error }} onReintentar={() => setRevision(v => v + 1)} /> : <>
        {aviso && <p className="pa-confirmacion" role="status"><Icono nombre="check" tam={18} />{aviso}</p>}
        <section className="fp-identidad" aria-label="Identidad de la cuenta">
          <div className="fp-avatar"><Avatar userId={perfil.id} iniciales={iniciales(perfil.nombre)} nombre={perfil.nombre} clase="fp-avatar-foto" tam={240} /></div>
          <div className="fp-identidad-datos"><h2>{perfil.nombre}</h2><Tag color="azul">{perfil.rol}</Tag><p>{perfil.email}</p>{perfil.empresa && <p><Icono nombre="empresa" tam={16} />{perfil.empresa}</p>}</div>
          <FotoDePerfil userId={perfil.id} />
        </section>
        <div className="fp-principal">
          <Tarjeta titulo="Datos personales"><dl className="fp-datos">{campos.map(([icono, nombre, contenido]) => <div key={nombre}><Icono nombre={icono} tam={23} /><div><dt>{nombre}</dt><dd>{contenido}</dd></div></div>)}</dl></Tarjeta>
          <Tarjeta titulo="Acceso a la cuenta"><div className="fp-acceso"><Icono nombre="escudo" tam={64} /><div><p>Cambia tu contraseña desde Mi perfil en la app.</p><button className="pnl-btn" onClick={() => setSeguridad(true)}>Ver instrucciones<Icono nombre="flecha" tam={16} /></button></div></div></Tarjeta>
        </div>

        <Tarjeta titulo="Mis documentos">
          {perfil.documentosError ? <div className="pa-error" role="alert"><p>{perfil.documentosError}</p><button className="pnl-btn" onClick={() => setRevision(v => v + 1)}>Volver a cargar</button></div> : documentos.length ? <div className="pnl-tabla-wrap"><table className="pnl-tabla fp-documentos"><thead><tr><th>Tipo</th><th>Número</th><th>Vencimiento</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{documentos.map((d, i) => <tr key={d.id || `${d.tipo}-${i}`}><td><span className="fp-doc-tipo"><Icono nombre="documento" tam={22} />{d.tipo}</span>{d.declarado && <small className="fp-declarado">Dato declarado en tu perfil</small>}</td><td>{d.numero || 'Sin registrar'}</td><td>{d.venceEn ? fecha(d.venceEn) : 'Sin fecha registrada'}</td><td>{ESTADOS[d.estado] ? <Tag color={ESTADOS[d.estado][1]}>{ESTADOS[d.estado][0]}</Tag> : <Tag>Sin estado disponible</Tag>}</td><td><button className="pnl-btn sutil" aria-label={`Ver información de ${d.tipo}`} onClick={() => setDocumento(d)}>Ver información<Icono nombre="flecha" tam={16} /></button></td></tr>)}</tbody></table></div> : <Vacio icono="documento" titulo="Sin documentos para mostrar" texto="Tus documentos personales aparecerán aquí cuando estén disponibles." />}
          <p className="pa-ayuda"><Icono nombre="info" tam={16} />Para fotos y vencimientos, usa Mi perfil de la app.</p>
        </Tarjeta>
        {perfil.aviso && <p className="pa-nota fp-disponibilidad">{perfil.aviso}</p>}
      </>}
    </div>
    <EditarMisDatos abierto={editando} perfil={perfil} borrador={borrador} setBorrador={setBorrador}
      guardando={guardando} error={error} alGuardar={guardar} alCancelar={cancelar} />
    <Modal abierto={Boolean(documento)} titulo="Información del documento" alCerrar={() => setDocumento(null)} ancho={760}><div className="pa-modal">{documento && <><h3 className="fp-modal-tipo"><Icono nombre="documento" tam={26} />{documento.tipo}</h3><Datos items={[{ etiqueta: 'Número', valor: documento.numero || 'Sin registrar' }, { etiqueta: 'Vencimiento', valor: documento.venceEn ? fecha(documento.venceEn) : 'Sin fecha registrada' }, { etiqueta: 'Estado', valor: ESTADOS[documento.estado]?.[0] || 'Sin estado disponible' }]} /><p className="pa-ayuda">{documento.declarado ? 'Dato declarado en tu perfil.' : 'Documento registrado en tu cuenta.'}</p>{claveDeTipo(documento.tipo) && perfil?.id ? <FotosDe huecos={huecosPersona(perfil.id, claveDeTipo(documento.tipo))} /> : documento.id && !documento.declarado ? <ArchivosDeDocumento documento={documento} /> : <p className="pa-nota">Este documento no admite fotos todavía.</p>}<div className="pa-modal-acciones"><button className="pnl-btn primario" onClick={() => setDocumento(null)}>Entendido</button></div></>}</div></Modal>
    <Modal abierto={seguridad} titulo="Seguridad de la cuenta" alCerrar={() => setSeguridad(false)} ancho={560}><div className="pa-modal"><div className="fp-seguridad-icono"><Icono nombre="escudo" tam={48} /></div><h3>Cambia tu contraseña en la app</h3><p className="pa-nota">Abre FOM en tu teléfono y sigue estos pasos:</p><ol className="fp-pasos"><li>Entra en <strong>Mi perfil</strong>.</li><li>Abre <strong>Seguridad</strong>.</li><li>Selecciona <strong>Cambiar contraseña</strong>.</li></ol><div className="pa-modal-acciones"><button className="pnl-btn primario" onClick={() => setSeguridad(false)}>Entendido</button></div></div></Modal>
  </div>
}
