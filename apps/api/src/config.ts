import { loadServerEnv, type ServerEnv } from '@remindora/config';
import { decodeKey } from '@remindora/auth';

export const ENV = Symbol('ENV');
export const KEYS = Symbol('KEYS');

export interface Keys {
  jwt: Buffer;
  encryption: Buffer;
  pairing: Buffer;
  otpPepper: Buffer;
}

export function buildKeys(env: ServerEnv): Keys {
  return {
    jwt: decodeKey(env.JWT_SECRET, 'JWT_SECRET'),
    encryption: decodeKey(env.ENCRYPTION_KEY, 'ENCRYPTION_KEY'),
    pairing: decodeKey(env.PAIRING_KEY, 'PAIRING_KEY'),
    otpPepper: decodeKey(env.OTP_PEPPER, 'OTP_PEPPER'),
  };
}

export { loadServerEnv, type ServerEnv };
