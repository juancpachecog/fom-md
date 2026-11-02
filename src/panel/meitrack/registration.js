import { parseRegistrationWitness, registerMeitrackOnce } from './meitrack-setup.js'

// Only opaque hashes and the resulting id survive a reload. No SMS, password or
// device metadata is retained. Failure to retain the marker blocks the POST.
export async function registerInventory(payload, { request, storage, digest }) {
  const unit = await digest(payload.imei)
  const fingerprint = await digest(JSON.stringify(payload))
  const key = `fom-727-registration:${unit}`
  const retained = storage.getItem(key)
  let marker = null
  if (retained !== null) {
    marker = JSON.parse(retained)
    if (!marker || marker.fingerprint !== fingerprint) throw Error('Hay un intento pendiente con otros datos. Compruebe el inventario antes de cambiar el alta.')
  }
  const result = await registerMeitrackOnce({
    attempted: marker !== null,
    deviceId: marker?.id ?? null,
    lookup: async () => {
      const value = parseRegistrationWitness(await request('registration', payload))
      if (!value) throw Error('No se pudo comprobar el registro de forma independiente.')
      return value
    },
    retainAttempt: id => {
      const value = JSON.stringify({ fingerprint, id })
      storage.setItem(key, value)
      if (storage.getItem(key) !== value) throw Error('No se pudo conservar el intento. El alta permanece bloqueada.')
    },
    create: async () => (await request('register', payload))?.id ?? null,
  })
  if (result.state !== 'confirmed') throw Error('Alta pendiente de comprobación. Consulte de nuevo; no repita el SMS ni el registro.')
  return result.id
}

export async function sha256(value) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}
