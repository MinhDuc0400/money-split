import { Stack } from 'expo-router';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { store, persistor } from '../src/store';
import { SocketManager } from '../src/components/SocketManager';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Provider store={store}>
        <PersistGate loading={null} persistor={persistor}>
          <SocketManager />
          <Stack screenOptions={{ headerShown: false }} />
        </PersistGate>
      </Provider>
    </GestureHandlerRootView>
  );
}
