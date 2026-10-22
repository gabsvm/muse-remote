// Credential-free browser E2E fixture. It never starts muse serve.
'use strict';
process.env.MUSE_REMOTE_TOKEN='e2e-test-token-not-real-1234567890';
const {server}=require('../../server');
const port=8897;
server.listen(port,'127.0.0.1',()=>{
  console.log('E2E mock bridge on loopback '+port);
});
process.on('SIGINT',()=>server.close());
process.on('SIGTERM',()=>server.close());
