import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from '@/theme';
import { FomProvider, useFom } from '@/fom/provider';
function Routes() {
  const { state } = useFom(); const { colors } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
    <Stack.Protected guard={state.phase !== 'ready' && state.phase !== 'restricted'}><Stack.Screen name="login" /></Stack.Protected>
    <Stack.Protected guard={state.phase === 'restricted'}><Stack.Screen name="password" /></Stack.Protected>
    <Stack.Protected guard={state.phase === 'ready'}><Stack.Screen name="index" /></Stack.Protected>
  </Stack>;
}
export default function RootLayout() {
  return <SafeAreaProvider><ThemeProvider><FomProvider><Routes /></FomProvider></ThemeProvider></SafeAreaProvider>;
}
