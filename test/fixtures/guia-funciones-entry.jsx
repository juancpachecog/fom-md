import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import GuiaFunciones from '../../src/panel/modulos/GuiaFunciones'
export {pasosGuiaFunciones} from '../../src/panel/modulos/GuiaFunciones'
export const renderGuia=family=>renderToStaticMarkup(<GuiaFunciones protocolFamily={family}/> )
