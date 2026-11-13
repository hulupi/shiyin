import { gunzipSync, gzipSync } from 'node:zlib';
// Windows has no POSIX execute bits. Normalize lifecycle script modes in the
// outer tar only; app.tgz and its manifest checksum remain byte-for-byte intact.
export function normalizeFpkModes(bytes) {
  const tar=gunzipSync(bytes);
  for(let offset=0;offset+512<=tar.length;) {
    const header=tar.subarray(offset,offset+512);
    if(header.every(byte=>byte===0)) break;
    const name=header.subarray(0,100).toString().replace(/\0.*$/s,'');
    const size=parseInt(header.subarray(124,136).toString().replace(/\0.*$/s,'').trim(),8)||0;
    if(name.startsWith('cmd/') && header[156]!==53) {
      header.write('0000755\0',100,8,'ascii');
      header.fill(32,148,156);
      const sum=header.reduce((value,byte)=>value+byte,0);
      header.write(sum.toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');
    }
    offset+=512+Math.ceil(size/512)*512;
  }
  return gzipSync(tar);
}
