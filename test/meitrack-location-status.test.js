import {test} from 'node:test'
import assert from 'node:assert/strict'
import {locationStatus} from '../src/panel/meitrack/location-status.js'
import {lecturaTrama} from '../src/panel/datos/gps.js'
test('receiving, missing clock, absent fix and pending publication never claim map availability',()=>{
 for(const state of ['reception_pending','clock_pending','fix_pending','projection_pending','assignment_pending','stale','unavailable'])
   assert.equal(locationStatus({state}).available,false)
 assert.equal(locationStatus({state:'available'}).available,true)
 assert.match(locationStatus({state:'clock_pending'}).detail,/DB4/)
})
test('neutral receipt label does not claim unqualified positions after a real location has been published',()=>{
 assert.equal(lecturaTrama('meitrack-t399 · meitrack_received · time_unproven'),'Trama Meitrack recibida')
})
test('missing or unknown server diagnostic fails closed and does not render server strings as instructions',()=>{
 for(const value of [null,undefined,{}, {state:'connected'},{state:'__proto__'},{state:'constructor'},{state:'<script>'}])
  assert.deepEqual(locationStatus(value),locationStatus({state:'unavailable'}))
})
