import {test} from 'node:test'
import assert from 'node:assert/strict'
import {canArchiveGps,gpsEditChanges,samePhoneRecords} from '../src/panel/datos/gpsInventory.js'
test('retiro de inventario nunca ofrece archivar instalado o activo',()=>{
 const g={id:'synthetic',estado:'inventory'}
 assert.equal(canArchiveGps(g),true)
 for(const extra of [{vehiculoId:'unit'},{instalacionId:'installation'},{estado:'active'},{estado:'archived'}])assert.equal(canArchiveGps({...g,...extra}),false)
})
test('edición conserva omisiones y permite limpiar SIM y serial sin modificar identidad',()=>{
 const before={imei:'999825000000001',estado:'inventory',fabricante:'Coban',serie:'OLD',simPhone:'04140000000',iccid:'8900000000000000001'}
 assert.deepEqual(gpsEditChanges({...before},before),{})
 assert.deepEqual(gpsEditChanges({...before,serie:'',iccid:'',imei:'other'},before),{iccid:null,serialNumber:null})
 assert.throws(()=>gpsEditChanges({...before,iccid:'123'},before),/18 y 22/)
})
test('advertencia de SIM reconoce formato nacional e internacional y excluye archivados',()=>{
 const rows=[{id:'active',linea:'+58 414 0000000',estado:'active'},{id:'inventory',simPhone:'0414-0000000',estado:'inventory'},{id:'archived',linea:'04140000000',estado:'archived'}]
 assert.deepEqual(samePhoneRecords(rows,'04140000000').map(x=>x.id),['active','inventory'])
 assert.deepEqual(samePhoneRecords(rows,'414'),[])
 assert.deepEqual(samePhoneRecords(rows,'04140000001'),[])
})
