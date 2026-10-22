import { decodeKey } from '@remindora/auth';
import type { ServerEnv } from '@remindora/config';

export function buildKeysFromEnv(env: ServerEnv) {
  return { encryption: decodeKey(env.ENCRYPTION_KEY, 'ENCRYPTION_KEY') };
}
