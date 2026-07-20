import { configureStore } from '@reduxjs/toolkit';
import { persistStore, persistReducer, FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER } from 'redux-persist';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { combineReducers } from 'redux';
import authReducer from './slices/authSlice';
import groupReducer from './slices/groupSlice';

const authPersistConfig = { key: 'auth', storage: AsyncStorage };

const rootReducer = combineReducers({
  auth: persistReducer(authPersistConfig, authReducer),
  group: groupReducer,
});

export const store = configureStore({
  reducer: rootReducer,
  middleware: getDefault =>
    getDefault({ serializableCheck: { ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER] } }),
});

export const persistor = persistStore(store);
export type RootState = ReturnType<typeof rootReducer>;
export type AppDispatch = typeof store.dispatch;
