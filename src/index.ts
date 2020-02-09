import { ApiPromise, WsProvider } from '@polkadot/api';
import { CronJob } from 'cron';

import Config from '../config.json';
import Database from './db';
import Monitor from './monitor';
import Scorekeeper from './scorekeeper';
import Server from './server';
import TelemetryClient from './telemetry';

const sleep = (ms: number) => (
  new Promise((resolve: any) => {
    setTimeout(() => resolve(), ms);
  })
);

try {
  (
    async () => {
      const api = await ApiPromise.create({
        provider: new WsProvider(Config.global.wsEndpoint),
      });

      const db = new Database(Config.db.storageFile);
      const server = new Server(db, Config.server.port);

      const telemetry = new TelemetryClient(Config, db);
      telemetry.start();

      // Give it some time to set up.
      await sleep(3000);
      
      /// The monitoring service that keeps our nodes on their feet.
      const monitor = new Monitor(db, 16 * 60 * 60 * 1000);
      const monitorFrequency = Config.global.test? '0 0-59/1 * * * *' : '0 0-59/5 * * * *';

      new CronJob(monitorFrequency, async () => {
        console.log('Monitor cronjob started. Running every five minutes.');
        await monitor.getLatestTaggedRelease();
        await monitor.ensureUpgrades();
      }).start();

      /// Time to start the nominators.
      const scorekeeper = new Scorekeeper(api, db, Config);
      for (const nominator of Config.scorekeeper.nominators) {
        await scorekeeper.spawn(nominator.seed);
      }

      /// And add the candidates.
      for (const candidate of Config.scorekeeper.candidates) {
        await db.addCandidate(candidate.name, candidate.stash);
      }

      const scorekeeperFrequency = Config.global.test? '0 0-59/3 * * * *' : '0 0 0 * * *';

      scorekeeper.begin(scorekeeperFrequency);
    }
  )();
} catch (err) { console.error(err); }