import { buildApp } from './app.js';
import { config } from './config.js';

const { app } = await buildApp();

const address = await app.listen({ host: config.host, port: config.port });
app.log.info({ address }, 'PRD Genie is ready');

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Stopping PRD Genie');
  await app.close();
  process.exit(0);
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

// When the macOS app is force-quit it cannot stop this server. The app passes its
// process ID; once that process is gone, shut down instead of lingering.
const parentPid = Number(process.env.PRD_GENIE_PARENT_PID);
if (Number.isInteger(parentPid) && parentPid > 1) {
  const watcher = setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        clearInterval(watcher);
        void shutdown('parent-exit');
      }
    }
  }, 2000);
  watcher.unref();
}
