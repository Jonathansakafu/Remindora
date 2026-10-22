import Constants from 'expo-constants';

export const API_URL: string = (process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra?.apiUrl as string) ?? 'http://10.0.2.2:4000').replace(/\/$/, '');
export const APP_VERSION = Constants.expoConfig?.version ?? '0.1.0';
