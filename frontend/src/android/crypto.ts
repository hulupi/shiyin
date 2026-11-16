import forge from 'node-forge';
import { Buffer } from 'buffer';

export function randomBytes(size: number) {
  return Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(size)));
}

export function createHash(algorithm: 'md5' | 'sha1') {
  const digest = forge.md[algorithm].create();
  const hash = {
    update(value: string | Uint8Array) {
      digest.update(Buffer.from(value).toString('binary'));
      return hash;
    },
    digest(encoding: BufferEncoding) {
      return Buffer.from(digest.digest().getBytes(), 'binary').toString(encoding);
    },
  };
  return hash;
}

export function createCipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array | null) {
  const mode = /^aes-(?:128|192|256)-(cbc|ecb)$/i.exec(algorithm)?.[1];
  if (!mode) throw new Error('不支持的 AES 模式');
  const cipher = forge.cipher.createCipher(mode.toLowerCase() === 'cbc' ? 'AES-CBC' : 'AES-ECB', Buffer.from(key).toString('binary'));
  cipher.start({ iv: iv ? Buffer.from(iv).toString('binary') : '' });
  return {
    update(value: string | Uint8Array) {
      cipher.update(forge.util.createBuffer(Buffer.from(value).toString('binary')));
      return Buffer.from(cipher.output.getBytes(), 'binary');
    },
    final() {
      if (!cipher.finish()) throw new Error('AES 加密失败');
      return Buffer.from(cipher.output.getBytes(), 'binary');
    },
  };
}

export const constants = { RSA_NO_PADDING: 3 };

export function publicEncrypt(options: { key: string; padding: number }, input: Uint8Array) {
  const key = forge.pki.publicKeyFromPem(options.key);
  const number = new forge.jsbn.BigInteger(Buffer.from(input).toString('hex'), 16);
  if (number.compareTo(key.n) >= 0) throw new Error('无效的 RSA 输入');
  const size = Math.ceil(key.n.bitLength() / 8);
  return Buffer.from(number.modPow(key.e, key.n).toString(16).padStart(size * 2, '0'), 'hex');
}
