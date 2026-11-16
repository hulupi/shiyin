import { Inflate, deflate } from 'pako';
import { Buffer } from 'buffer';

export function inflateSync(input: Uint8Array, options: { maxOutputLength: number }) {
  const inflater = new Inflate({ chunkSize: 65536 });
  let length = 0;
  const chunks: Uint8Array[] = [];
  inflater.onData = chunk => {
    if (typeof chunk === 'string') throw new Error('无效的压缩数据');
    length += chunk.length;
    if (length > options.maxOutputLength) throw new Error('解压结果过大');
    chunks.push(chunk);
  };
  if (!inflater.push(input, true) || inflater.err) throw new Error('解压失败');
  return Buffer.concat(chunks);
}

export const deflateSync = deflate;
