import { useRef, useState } from 'react';
import { useFom } from '@/fom/provider';
import { Button, Copy, Field, Page, message } from '@/fom/ui';
export default function InitialPassword() {
  const { logout, changeInitialPassword } = useFom(); const [current, setCurrent] = useState(''); const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const pending = useRef(false);
  async function submit() {
    if (pending.current) return;
    if (next !== confirmation || next.length < 16 || next.length > 256 || current === next) { setError('Use una clave nueva de 16–256 caracteres y confirme que coincide.'); return; }
    pending.current = true; setBusy(true); setError('');
    try { await changeInitialPassword(current, next); } catch (e) { setError(message(e)); }
    finally { setCurrent(''); setNext(''); setConfirmation(''); setBusy(false); pending.current = false; }
  }
  return <Page title="Cambiar contraseña inicial">
    <Copy>Su cuenta requiere completar este cambio. Después deberá ingresar de nuevo; las sesiones anteriores se revocan.</Copy>
    {error ? <Copy alert>{error}</Copy> : null}
    <Field label="Contraseña actual" value={current} onChangeText={setCurrent} secureTextEntry editable={!busy} />
    <Field label="Nueva contraseña" value={next} onChangeText={setNext} secureTextEntry editable={!busy} />
    <Field label="Confirmar nueva contraseña" value={confirmation} onChangeText={setConfirmation} secureTextEntry editable={!busy} />
    <Button label="Guardar nueva contraseña" loading={busy} onPress={() => void submit()} />
    <Button label="Salir" variant="secondary" disabled={busy} onPress={() => void logout()} />
  </Page>;
}
