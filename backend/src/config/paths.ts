import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const root=fileURLToPath(new URL('../../../',import.meta.url));
export const dataDir=path.resolve(process.env.SHIYIN_DATA_DIR||path.join(root,'backend','data'));
