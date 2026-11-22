import http from 'node:http';
import app from './app.js';
import {env} from './config/env.js';
import {connectDatabase} from './config/db.js';
import {makeSocketServer} from './realtime.js';
const server=http.createServer(app);let io;
async function start(){await connectDatabase();io=makeSocketServer(server);server.listen(env.PORT,()=>console.log(`CampusCart API listening at http://localhost:${env.PORT}`))}
async function shutdown(signal){console.log(`${signal} received`);io?.close();server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),10000).unref()}
process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));
start().catch(err=>{console.error('Startup failed:',err);process.exit(1)});
