void import('./backend/src/index.js').then(({ server }) => {
  function ready() {
    process.parentPort.postMessage({ port: server.address().port });
  }
  if (server.listening) ready();
  else server.once('listening', ready);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
