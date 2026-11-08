import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import GuiaFunciones from '../../src/panel/modulos/GuiaFunciones'
import '../../src/styles/panel.css'
import '../../src/panel/modulos/catalogo-funciones.css'
import {aplicarTema} from '../../src/panel/tema'
aplicarTema('oscuro')
function Fixture(){
 const [family,setFamily]=useState('meitrack-t399')
 return <main className="pnl catalogo-funciones" style={{padding:24,minHeight:'100vh'}}><p>ENSAYO SINTÉTICO · sin API ni hardware</p><label>Familia de ensayo<select value={family} onChange={e=>setFamily(e.target.value)}><option value="meitrack-t399">Meitrack</option><option value="coban-gps103">Coban</option></select></label><GuiaFunciones key={family} protocolFamily={family}/></main>
}
createRoot(document.getElementById('root')).render(<Fixture/> )
