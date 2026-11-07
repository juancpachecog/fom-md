// Sólo fixture local de revisión visual; no se importa desde el producto.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import '../../src/styles/panel.css'
import '../../src/styles/redesign.css'
import '../../src/styles/apariencia.css'
import CatalogoFunciones from '../../src/panel/modulos/CatalogoFunciones'
createRoot(document.getElementById('root')).render(<MemoryRouter><div className="pnl fom-dark" data-diseno="solido" style={{display:'block',minHeight:'100vh'}}>
  <p style={{margin:0,padding:'12px 28px',color:'var(--e-aviso)'}}>VISTA SINTÉTICA · datos de prueba locales · sin conexión a producción</p>
  <CatalogoFunciones categoria="variable" />
</div></MemoryRouter>)
