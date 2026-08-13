import { createCipheriv, createDecipheriv } from 'node:crypto';

const SECRET_KEY = 'vpRZ1kmU';
const IV = 'EbpU4WtY';

// OpenSSL 3 disables single DES by default. EDE3 with the same key repeated
// three times is cryptographically equivalent to DES-CBC and remains available
// on every Node.js version supported by this plugin.
const COMPATIBLE_KEY = SECRET_KEY.repeat(3);

export const encodeDes = (plainText: string) => {
  const cipher = createCipheriv('des-ede3-cbc', COMPATIBLE_KEY, IV);
  cipher.setAutoPadding(true);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
};

export const decodeDes = (encrypted: string) => {
  const decipher = createDecipheriv('des-ede3-cbc', COMPATIBLE_KEY, IV);
  decipher.setAutoPadding(true);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};
