import { parentPort, workerData } from 'node:worker_threads';
import { Buffer } from 'node:buffer';
import { createHash, createCipheriv, publicEncrypt, randomBytes, constants } from 'node:crypto';
import { inflateSync, deflateSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { startSourceRuntime } from './runtime.mjs';

const bootstrap = await readFile(new URL('./bootstrap.js', import.meta.url), 'utf8');
await startSourceRuntime(workerData, bootstrap, message => parentPort.postMessage(message),
  receive => parentPort.on('message', receive),
  { Buffer, createHash, createCipheriv, publicEncrypt, randomBytes, constants, inflateSync, deflateSync });
