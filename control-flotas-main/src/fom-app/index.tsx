import { Workspace } from '@/fom/workspace';
import { useFom } from '@/fom/provider';
export default function Home() {
  const { state } = useFom();
  return <Workspace key={state.identity?.session.id ?? 'no-session'} />;
}
