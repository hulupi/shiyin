// @ts-expect-error The shared runtime is a JavaScript module used by both worker hosts.
import { startSourceRuntime } from '../../../backend/src/source-runtime/runtime.mjs';
import bootstrap from '../../../backend/src/source-runtime/bootstrap.js?raw';
import { Buffer } from 'buffer';
import { createHash, createCipheriv, publicEncrypt, randomBytes, constants } from './crypto';
import { inflateSync, deflateSync } from './compression';

self.addEventListener('message', async ({ data }) => {
  try {
    await startSourceRuntime({ ...data, environment: 'mobile' }, bootstrap,
      (message: unknown) => self.postMessage(message),
      (receive: (message: unknown) => void) => self.addEventListener('message', event => receive(event.data)),
      { Buffer, createHash, createCipheriv, publicEncrypt, randomBytes, constants, inflateSync, deflateSync });
  } catch {
    self.postMessage({ kind: 'error', error: '无法启动音源运行环境' });
  }
}, { once: true });
