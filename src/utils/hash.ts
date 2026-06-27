import { createHash } from 'crypto';

export const HashUtils = {
  generateTaskFingerprint: (payload: any): string => {
    const dataString = JSON.stringify(payload);
    return createHash('sha256').update(dataString).digest('hex').substring(0, 16);
  }
};
