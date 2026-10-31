import type { ReactNode } from 'react';
import { ScrollView, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { FomError } from './session';
export { Button } from '@/components/button';

export function Page({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
    {__DEV__ && process.env.EXPO_PUBLIC_FOM_TEST_FIXTURE === '1' && <Text style={{ padding: 12, color: colors.text, backgroundColor: colors.warningSurface }}>Ensayo local · datos sintéticos. No es un ambiente nominal ni una prueba física.</Text>}
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16, width: '100%', maxWidth: 760, alignSelf: 'center' }}>
      <Text accessibilityRole="header" style={{ fontSize: 24, fontWeight: '700', color: colors.text }}>{title}</Text>{children}
    </ScrollView>
  </SafeAreaView>;
}
export function Copy({ children, alert = false }: { children: ReactNode; alert?: boolean }) {
  const { colors } = useTheme();
  return <Text accessibilityRole={alert ? 'alert' : undefined} style={{ color: alert ? colors.danger : colors.text, lineHeight: 22 }}>{children}</Text>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const { colors } = useTheme();
  return <View style={{ gap: 6 }}><Copy>{label}</Copy><TextInput accessibilityLabel={label} autoCorrect={false}
    style={{ borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 8, padding: 12, minHeight: 46, color: colors.text, backgroundColor: colors.surface }} {...props} /></View>;
}
export function message(error: unknown): string {
  if (!(error instanceof FomError)) return 'No se pudo completar la operación. Reintente.';
  if (error.code === 'configuration_required') return 'La conexión con el servidor FOM aún no está configurada.';
  if (error.code === 'session_changed') return 'La sesión cambió. Vuelva a consultar con su cuenta.';
  if (error.code === 'selection_expired') return 'La selección de empresa venció. Inicie sesión de nuevo.';
  if (error.status === 401) return 'La sesión o las credenciales no son válidas. Inicie sesión de nuevo.';
  if (error.status === 403) return 'Su cuenta no tiene permiso para esta operación.';
  if ([400, 409, 422].includes(error.status)) return 'Revise los datos, la versión y los requisitos de la función.';
  if (error.status === 404) return 'El recurso no está disponible para su cuenta.';
  return 'No se pudo comprobar el resultado. Reintente la misma solicitud pendiente.';
}
