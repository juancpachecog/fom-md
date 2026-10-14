import { Campo, Modal } from './ui'
import { Icono } from '../Iconos'
import Avatar from './Avatar'
import FotosIdentidad from './FotosIdentidad'
import CambiarFoto from './CambiarFoto'
import { cloudinaryConfigurado, etiquetas, ids } from '../datos/cloudinary'
import { iniciales } from '../datos/formato'
import './editar-mis-datos.css'

// ============================================================
// «EDITAR MIS DATOS» (Mi perfil)
// ------------------------------------------------------------
// Arriba la foto, que se cambia al momento (no espera a «Guardar»), y
// debajo los datos en tres grupos: personales, contacto y acceso. Los
// mismos campos que pide la app; el correo lo cambia un administrador.
// ============================================================

function Entrada({ clave, borrador, setBorrador, guardando, ...resto }) {
  return (
    <input
      className="pnl-input"
      value={borrador[clave] || ''}
      disabled={guardando}
      onChange={(e) => setBorrador((b) => ({ ...b, [clave]: e.target.value }))}
      {...resto}
    />
  )
}

export default function EditarMisDatos({ abierto, perfil, borrador, setBorrador, guardando, error, alGuardar, alCancelar }) {
  const userId = perfil?.id
  const props = { borrador, setBorrador, guardando }
  return (
    <Modal abierto={abierto} titulo="Editar mis datos" alCerrar={alCancelar} ancho={720}>
      <form className="emd" onSubmit={alGuardar}>
        <section className="emd-foto" aria-label="Foto de perfil">
          <Avatar userId={userId} iniciales={iniciales(borrador.nombre || perfil?.nombre || '')} nombre={perfil?.nombre} clase="pnl-avatar-l emd-avatar" tam={192} />
          <div className="emd-foto-texto">
            <b>{borrador.nombre || perfil?.nombre}</b>
            <span>{perfil?.email}</span>
            {userId && cloudinaryConfigurado() ? (
              <>
                <CambiarFoto flotante={false} publicId={ids.avatar(userId)} etiqueta={etiquetas.avatar(userId)} titulo="Foto de perfil" textos={{ subir: 'Subir o cambiar foto' }} />
                <small>JPG, PNG o WebP. Se guarda al instante y se ve en tu perfil y en la flota.</small>
              </>
            ) : (
              <small>La foto de perfil se activa cuando se conecte el almacén de fotos a esta web.</small>
            )}
          </div>
        </section>

        <fieldset className="emd-grupo">
          <legend>Datos personales</legend>
          <div className="emd-campos">
            <div className="emd-ancho">
              <Campo etiqueta="Nombre y apellido">
                <Entrada clave="nombre" {...props} required maxLength={160} autoComplete="name" placeholder="Ej.: Marco Pacheco" />
              </Campo>
            </div>
            <Campo etiqueta="Cédula" ayuda="V o E y el número: V12345678.">
              <Entrada clave="cedula" {...props} placeholder="V12345678" autoComplete="off" />
            </Campo>
            <Campo etiqueta="Fecha de nacimiento">
              <Entrada clave="fechaNacimiento" {...props} type="date" autoComplete="bday" />
            </Campo>
          </div>
        </fieldset>

        <fieldset className="emd-grupo">
          <legend>Contacto</legend>
          <div className="emd-campos">
            <Campo etiqueta="Teléfono" ayuda="0414-1234567 o con el código de país, +58.">
              <Entrada clave="telefono" {...props} type="tel" placeholder="0414-1234567" autoComplete="tel" />
            </Campo>
            <Campo etiqueta="Dirección">
              <Entrada clave="direccion" {...props} maxLength={300} placeholder="Ciudad, sector y calle" autoComplete="street-address" />
            </Campo>
          </div>
        </fieldset>

        {perfil?.id && (
          <fieldset className="emd-grupo">
            <legend>Fotos de tus documentos</legend>
            <p className="emd-nota">Cada foto se guarda al subirla, sin esperar a «Guardar cambios».{perfil?.conduce ? ' Como conduces, también van tu licencia y tu carta médica.' : ''}</p>
            <FotosIdentidad userId={perfil.id} conduce={Boolean(perfil?.conduce)} />
          </fieldset>
        )}

        <fieldset className="emd-grupo">
          <legend>Acceso</legend>
          <div className="emd-acceso">
            <Icono nombre="escudo" tam={18} />
            <div>
              <b>{perfil?.email || 'Sin correo'}</b>
              <span>Tu correo de acceso y tu rol los cambia un administrador.</span>
            </div>
          </div>
        </fieldset>

        {!perfil?.completoDisponible && <p className="emd-nota">Si un dato sale vacío, escribe un valor solo cuando quieras actualizarlo: lo vacío no borra nada.</p>}
        {error && <p className="pnl-campo-error" role="alert">{error}</p>}

        <div className="emd-acciones">
          <button type="button" className="pnl-btn" disabled={guardando} onClick={alCancelar}>Cancelar</button>
          <button className="pnl-btn primario" disabled={guardando}>
            <Icono nombre="check" tam={16} />{guardando ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
