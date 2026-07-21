import { Redirect, useLocalSearchParams } from 'expo-router';

export default function JoinCodeRedirect() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <Redirect href={`/group/join?code=${code}` as any} />;
}
