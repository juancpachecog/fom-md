import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { apiBase, FomSession, type SessionState, type TokenStorage } from './session';

const key = 'fom.mobile.session.v1';
let webMemory: string | null = null; // Web preview never puts tokens in localStorage/cookies.
const storage: TokenStorage = {
  async read() { return Platform.OS === 'web' ? webMemory : SecureStore.getItemAsync(key); },
  async write(value) {
    if (Platform.OS === 'web') { webMemory = value; return; }
    if (!await SecureStore.isAvailableAsync()) throw Error('secure_storage_unavailable');
    await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  },
  async clear() { if (Platform.OS === 'web') webMemory = null; else await SecureStore.deleteItemAsync(key); },
};
const Context = createContext<{ client: FomSession; state: SessionState; configured: boolean; notice: string;
  logout: () => Promise<void>; changeInitialPassword: (current: string, next: string) => Promise<void> } | null>(null);
export function FomProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => {
    let base = '';
    try { base = apiBase(process.env.EXPO_PUBLIC_FOM_API_BASE_URL ?? '', __DEV__); } catch { /* explicit unconfigured UI */ }
    return new FomSession(base, storage, fetch, Date.now, Platform.OS);
  }, []);
  const [state, setState] = useState(client.state);
  const [notice, setNotice] = useState('');
  const logout = useCallback(async () => {
    const confirmed = await client.signOut();
    setNotice(confirmed ? 'Sesión cerrada.' : 'La sesión dejó de usarse en esta instancia; no se pudo confirmar la limpieza local o la revocación remota.');
  }, [client]);
  const changeInitialPassword = useCallback(async (current: string, next: string) => {
    try { await client.changeInitialPassword(current, next); setNotice('Contraseña actualizada. Ingrese de nuevo con su nueva clave.'); }
    catch (error) { if (client.state.phase === 'signedOut') setNotice('No se pudo confirmar el cambio. Ingrese de nuevo para comprobar su cuenta.'); throw error; }
  }, [client]);
  useEffect(() => {
    const unsubscribe = client.subscribe(() => { setState(client.state); if (client.state.phase === 'ready') setNotice(''); });
    if (client.base) void client.restore();
    return unsubscribe;
  }, [client]);
  return <Context.Provider value={{ client, state, configured: !!client.base, notice, logout, changeInitialPassword }}>{children}</Context.Provider>;
}
export function useFom() {
  const context = useContext(Context);
  if (!context) throw Error('FOM_PROVIDER_REQUIRED');
  return context;
}
