// La pantalla de carga de FOM: las tres flechas entran, se escribe «FOM» y una luz corre hacia
// adelante mientras carga. La misma animación que la app del teléfono. Los estilos viven en
// /public/carga-fom.css (enlazado en index.html) para que también se vea antes de que cargue React.
export const FLECHAS_FOM = [
  'M3 25h14a4 4 0 0 1 3.4 1.9l9.7 15a4 4 0 0 1 0 4.3l-9.7 15A4 4 0 0 1 17 63H4a3 3 0 0 1-2.5-4.7L10 45a4 4 0 0 0 0-4.3L.5 29.7A3 3 0 0 1 3 25Z',
  'M24 13h18a5 5 0 0 1 4.2 2.3l16.2 25a5 5 0 0 1 0 5.4L46.2 71A5 5 0 0 1 42 73H26a4 4 0 0 1-3.4-6.1l13.6-21a5 5 0 0 0 0-5.4l-15.6-21A4 4 0 0 1 24 13Z',
  'M50 0h24a6 6 0 0 1 5 2.7l24 36a6 6 0 0 1 0 6.6L79 79.3a6 6 0 0 1-5 2.7H53a5 5 0 0 1-4.2-7.7l20.7-29a6 6 0 0 0 0-6.6L45.8 7.7A5 5 0 0 1 50 0Z',
]

export default function CargaFom({ estado = 'Cargando', oculta = false }) {
  return (
    <div className={`carga-fom${oculta ? ' oculta' : ''}`} role="status" aria-live="polite" aria-label={`FOM · ${estado}`}>
      <div className="carga-fom-marca" aria-hidden="true">
        <svg className="carga-fom-flechas" viewBox="0 0 104 82">
          {FLECHAS_FOM.map((d) => <path key={d} d={d} />)}
        </svg>
        <div className="carga-fom-nombre"><span>F</span><span>O</span><span>M</span></div>
      </div>
      <p className="carga-fom-lema">Fleet Operations &amp; Maintenance</p>
      <div className="carga-fom-barra" aria-hidden="true" />
      <p className="carga-fom-estado">{estado}…</p>
    </div>
  )
}
