import { useRef, useState } from 'react';
import { useFom } from '@/fom/provider';
import { Button, Copy, Field, Page, message } from '@/fom/ui';
export default function Login() {
  const { client, state, configured, notice, logout } = useFom();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const submitting = useRef(false);
  async function act(action: () => Promise<unknown>) {
    if (submitting.current) return; submitting.current = true; setBusy(true); setError('');
    try { await action(); } catch (e) { setError(message(e)); }
    finally { setPassword(''); submitting.current = false; setBusy(false); }
  }
  return <Page title="Ingresar a FOM">
    <Copy>Use su cuenta FOM. La empresa y los permisos se comprueban en el servidor.</Copy>
    {!configured && <Copy alert>La conexión FOM está pendiente de configurar para este ambiente.</Copy>}
    {notice ? <Copy>{notice}</Copy> : null}
    {error ? <Copy alert>{error}</Copy> : null}
    {state.phase === 'restoring' ? <Copy>Comprobando la sesión…</Copy> : state.phase === 'selection' ? <>
      <Copy>Seleccione una de sus empresas autorizadas.</Copy>
      {state.selection?.tenants.map(tenant => <Button key={tenant.id} label={tenant.name} disabled={busy}
        onPress={() => void act(() => client.selectTenant(tenant.id))} />)}
      <Button label="Volver al ingreso" variant="secondary" disabled={busy} onPress={() => void act(logout)} />
    </> : <>
      {state.phase === 'unavailable' && <><Copy alert>No se pudo comprobar la sesión guardada. Sus datos no se han modificado.</Copy>
        <Button label="Reintentar comprobación" disabled={busy} onPress={() => void act(() => client.restore())} /></>}
      <Field label="Correo" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" editable={!busy} />
      <Field label="Contraseña" value={password} onChangeText={setPassword} secureTextEntry editable={!busy} autoCapitalize="none" />
      <Button label="Ingresar" loading={busy} disabled={!configured || !email.trim() || !password}
        onPress={() => void act(() => client.signIn(email.trim(), password))} />
    </>}
  </Page>;
}
