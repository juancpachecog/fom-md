import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import HardwareTelemetria from '../../src/panel/modulos/HardwareTelemetria'
import CatalogoFunciones from '../../src/panel/modulos/CatalogoFunciones'
export function render(vista, datos) {
  globalThis.__hardware807 = datos
  return renderToStaticMarkup(<MemoryRouter>{vista === 'variable' || vista === 'tag'
    ? <CatalogoFunciones categoria={vista} /> : <HardwareTelemetria vista={vista} />}</MemoryRouter>)
}
