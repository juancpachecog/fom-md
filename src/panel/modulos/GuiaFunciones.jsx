import {useState} from 'react'

const manualMeitrack='https://www.meitrack.com/cd-download/Product_User_Guide/MEITRACK_T399_Series_User_Guide.pdf'
const manualCoban='https://fccid.io/2ATUKBN-403/User-Manual/User-Manual-6024809.pdf'

export function pasosGuiaFunciones(family){
 const meitrack=family==='meitrack-t399',coban=family==='coban-gps103'
 return [
  {title:'Preparar el montaje',text:[
   'Comprueba la empresa, el vehículo y el GPS de esta pantalla. Trabaja con el vehículo estacionado, freno aplicado y motor apagado. Para probar contacto no hace falta arrancar.',
   'El instalador debe identificar el circuito con el esquema del vehículo y un multímetro de alta impedancia en voltaje continuo, dentro de su rango. No uses continuidad sobre un circuito alimentado, lámpara de prueba ni puentes hacia masa o positivo. No intervengas airbags, CAN, relés o inmovilizadores.',
   'Esta guía explica lecturas. Avanzar por sus pasos no guarda configuración, certifica una instalación ni habilita comandos.' ]},
  {title:'Identificar equipo y firmware',text:meitrack?[
   'Comprueba el sufijo exacto T399 de la etiqueta y el conector del arnés contra el manual de esa unidad. Conserva la versión de firmware documentada; una referencia de otro T399 no acredita este montaje.',
   'En la guía del fabricante de 2023, el pin 3/gris es Input 1, puerta con activación negativa de fábrica; el pin 4/blanco es Input 2, ACC con activación positiva de fábrica. Son referencias condicionadas: los modos se pueden cambiar y el arnés puede ser distinto. No elijas una entrada sólo por el color.'
  ]:coban?[
   'Lee modelo completo y sufijo de la etiqueta y busca el manual suministrado por ese proveedor. GPS-403, GPS103 o el nombre de una aplicación no identifican por sí solos el firmware.',
   'Busca una versión de firmware/software explícita en documentación de entrega o en la información de dispositivo de una herramienta oficial ya disponible, sólo en consulta. La versión de la app y una etiqueta de modelo no prueban la versión instalada. Si no aparece, conserva «firmware desconocido» y consulta al proveedor por el procedimiento de lectura para esa variante.',
   'No hay un SMS universal revisado para identificar todos los Coban. No pruebes comandos genéricos, actualizaciones, reinicios ni cambios de APN/servidor. Conserva versión y procedencia sin compartir IMEI, SIM, contraseñas o respuestas completas. El manual BN-403 enlazado es una referencia, no la identificación de tu unidad.'
  ]:[
   'Identifica modelo, firmware y manual exactos. Esta familia no tiene una guía de cableado específica aquí: conserva lo desconocido y utiliza sólo un perfil revisado para esa variante.'
  ]},
  {title:'Comprobar entrada y polaridad eléctrica',text:[
   'Con el esquema y una masa de referencia confirmada, el instalador mide la señal de puerta cerrada y abierta sin mover el vehículo. Anota tensión en ambos estados y entrada del GPS realmente conectada. Una señal que cae hacia masa al abrir suele ser de activación negativa; una que sube al nivel de activación admitido suele ser positiva. Una línea flotante, pulsada, con retardo o sin cambio claro no permite concluir: revisa el esquema y el manual, no conectes a prueba y error.',
   'Repite con contacto quitado y contacto puesto, sin arrancar. La señal ACC debe cambiar de forma consistente y cumplir los límites del modelo. No confundas ACC con alimentación permanente, accesorios temporizados o motor funcionando.',
   meitrack?'Confirma que la entrada está realmente en modo digital y cuál es su activación configurada. El modo eléctrico del GPS y el mapeo de FOM son ajustes distintos: esta guía no cambia el modo del equipo.':'En Coban confirma con el manual exacto qué entrada de puerta corresponde a la activación medida. No extrapoles colores de otro 403. La variante revisada debe transmitir puerta y ACC explícitos; una alarma aislada de apertura no demuestra el cierre.'
  ]},
  {title:'Configurar el perfil y las funciones',text:[
   'En «Perfil de compatibilidad» elige la versión revisada compatible. Para las lecturas nuevas Meitrack CCE o Coban ASCII se utiliza v2, sólo después de confirmar la variante. Cambiar perfil puede dejar vacía la propuesta de mapeo: reconstruye y revisa también las funciones que ya usabas antes de guardar.',
   'Pulsa «Añadir Puerta abierta» y «Añadir Contacto (ACC)». Para una entrada digital elige el canal de la entrada comprobada; para un campo explícito del protocolo utiliza su canal nativo revisado. No asignes la misma entrada física a dos funciones diferentes. Revisa el sensor/instancia de cada puerta.',
   '«Normal» conserva el booleano decodificado; «Invertida» lo niega. Activación eléctrica negativa NO significa elegir Invertida: un GPS puede transmitir true cuando su entrada negativa está activa. El objetivo es true=puerta abierta o contacto activo y false=puerta cerrada o sin contacto. Si ambos estados salen exactamente al revés, revisa primero canal y modo; invierte sólo al confirmar esa relación.',
   'Pulsa «Guardar mapeo y comprobar» cuando todas las filas estén revisadas. Se crea una versión nueva hacia adelante y sus pruebas quedan pendientes; no se modifica el historial ni se envía configuración al GPS.'
  ]},
  {title:'Probar puerta y contacto',text:[
   'Prueba una función cada vez y anota las horas reales. Para puerta: cerrada → abierta → cerrada; repite el ciclo. Para ACC: sin contacto → contacto activo → sin contacto, manteniendo el motor apagado; repite. Una lectura de otra puerta no verifica esta instancia.',
   'En la tabla consulta «Último valor», «Vigencia» y «Ver muestras». Espera una transmisión natural nueva después de cada cambio y comprueba su hora de evento y recepción. No avances por un valor viejo, sin dato, contradictorio o sin hora calificada. No hay un plazo universal: depende de la configuración de reporte y del reposo del equipo.',
   'Si falta un estado, no aparece recepción o la señal no cambia, deja la prueba pendiente/no conforme y revisa circuito, modo digital, compatibilidad y reporte. No cambies el reloj ni repitas el alta del GPS, ni envíes SMS para forzar un resultado.'
  ]},
  {title:'Registrar evidencia real',text:[
   'En la fila de cada función pulsa «Registrar prueba». Puedes actualizar las muestras desde ese formulario. Selecciona únicamente muestras elegibles nuevas del mapeo y montaje actuales, que representen los estados físicos comprobados, incluido el regreso al inicial; la ventana del formulario es de quince minutos y admite hasta ocho muestras.',
   'Elige «Conforme a lo inspeccionado» sólo si realmente verificaste la secuencia y confirma la inspección. Si falta evidencia, usa «No conforme» con el motivo correspondiente. «Registrar prueba y comprobar» guarda y vuelve a consultar el resultado; recorrer esta guía no registra PASS.',
   'Una prueba guardada no habilita por sí sola salidas ni comandos. Contacto activo no certifica giro del motor: hace falta RPM u otra fuente específica. Este perfil Coban no interpreta RPM; Meitrack sólo puede mostrarlo cuando la variante y el dato CAN real lo permitan.'
  ]}
 ]
}

export default function GuiaFunciones({protocolFamily}){
 const [step,setStep]=useState(0),steps=pasosGuiaFunciones(protocolFamily)
 return <details className="cf-editor cf-guide" open>
  <summary>Guía del instalador: puerta y contacto, paso a paso</summary>
  <p>Ayuda de consulta para este montaje. Usa los controles de configuración y prueba que aparecen debajo; esta guía no los ejecuta.</p>
  <nav aria-label="Pasos de la guía de funciones"><ol>{steps.map((s,i)=><li key={s.title}><button type="button" className="pnl-btn" aria-current={i===step?'step':undefined} onClick={()=>setStep(i)}>{i+1}. {s.title}</button></li>)}</ol></nav>
  <section aria-live="polite" aria-atomic="true" aria-label={`Paso ${step+1} de ${steps.length}`}>
   <h3>{step+1}. {steps[step].title}</h3>{steps[step].text.map(t=><p key={t}>{t}</p>)}
  </section>
  <div className="cf-toolbar"><button type="button" className="pnl-btn" disabled={step===0} onClick={()=>setStep(s=>s-1)}>Paso anterior</button><button type="button" className="pnl-btn primario" disabled={step===steps.length-1} onClick={()=>setStep(s=>s+1)}>Paso siguiente</button></div>
  <p>{protocolFamily==='meitrack-t399'?<a href={manualMeitrack} target="_blank" rel="noopener noreferrer">Manual Meitrack T399, referencia de conectores y modos (páginas 9–10 y 21)</a>:protocolFamily==='coban-gps103'?<a href={manualCoban} target="_blank" rel="noopener noreferrer">Manual del fabricante BN-403: referencia que debe coincidir con la unidad</a>:'Solicita la documentación exacta de esta variante al proveedor.'}</p>
 </details>
}
