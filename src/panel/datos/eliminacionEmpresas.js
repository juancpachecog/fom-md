import { pedir } from './api'
import { crearClienteEliminacionEmpresas } from './eliminacionEmpresasContrato'

export const eliminacionEmpresas = crearClienteEliminacionEmpresas(pedir)
