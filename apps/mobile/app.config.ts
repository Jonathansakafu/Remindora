import type { ConfigContext, ExpoConfig } from 'expo/config';
import { existsSync } from 'fs';

/**
 * Remindora for Android. Set EXPO_PUBLIC_API_URL for the API, and provide
 * google-services.json (or GOOGLE_SERVICES_JSON on EAS) to enable FCM push.
 */
// Local-network builds talk to the API over plain HTTP; Android needs that allowed explicitly.
const insecureApi = (process.env.EXPO_PUBLIC_API_URL ?? '').startsWith('http://');
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON ?? (existsSync('./google-services.json') ? './google-services.json' : undefined);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Remindora',
  slug: 'remindora',
  owner: 'jonathansakafu',
  version: '0.2.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'remindora',
  userInterfaceStyle: 'dark',
  backgroundColor: '#070D22',
  android: {
    package: 'app.remindora.mobile',
    versionCode: 1,
    adaptiveIcon: { foregroundImage: './assets/images/adaptive-foreground.png', backgroundColor: '#111C3E' },
    googleServicesFile,
    permissions: ['android.permission.POST_NOTIFICATIONS', 'android.permission.CAMERA', 'android.permission.USE_BIOMETRIC', 'android.permission.VIBRATE', 'android.permission.RECEIVE_BOOT_COMPLETED'],
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
    intentFilters: [
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'remindora' }],
      },
    ],
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    [
      'expo-build-properties',
      {
        android: {
          usesCleartextTraffic: insecureApi,
          // R8 strips Room's generated database classes, so WorkManager (used by notifications
          // and the widget) crashes at launch with "Failed to create an instance of WorkDatabase".
          extraProguardRules: ['-keep class * extends androidx.room.RoomDatabase { <init>(); }', '-keep class androidx.work.impl.** { *; }'].join('\n'),
        },
      },
    ],
    'expo-secure-store',
    ['expo-splash-screen', { backgroundColor: '#070D22', image: './assets/images/splash-icon.png', imageWidth: 120 }],
    ['expo-notifications', { icon: './assets/images/notification-icon.png', color: '#60E9FF', defaultChannel: 'remindora-alarm', sounds: ['./assets/sounds/remindora_alarm.wav'] }],
    ['expo-camera', { cameraPermission: 'Remindora uses the camera to scan the QR code that links this phone to your account.', recordAudioAndroid: false }],
    ['expo-local-authentication', { faceIDPermission: 'Remindora uses biometrics to lock the app and confirm device linking.' }],
    [
      'react-native-android-widget',
      {
        widgets: [
          {
            name: 'TodayWidget',
            label: 'Remindora · Today',
            description: 'Your top tasks for today',
            minWidth: '250dp',
            minHeight: '160dp',
            targetCellWidth: 4,
            targetCellHeight: 2,
            previewImage: './assets/images/icon.png',
            updatePeriodMillis: 1800000,
          },
        ],
      },
    ],
  ],
  experiments: { typedRoutes: false, reactCompiler: false },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000',
    eas: { projectId: process.env.EAS_PROJECT_ID ?? '84a6617c-4280-4c99-83a5-4ec13c5b5374' },
  },
});
