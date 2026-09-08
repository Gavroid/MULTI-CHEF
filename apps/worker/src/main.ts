import { IdleLoop, runWorker } from './loop.js';

// Entry point. Kept minimal for MC-001; nothing real to do yet.
void runWorker(new IdleLoop());
