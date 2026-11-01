import mongoose from 'mongoose';
import { config, isProduction } from './config.js';
import { logger } from './lib/events.js';
import { seedDemo, seedReferenceData } from './seedData.js';

await mongoose.connect(config().MONGO_URL);
// Production gets reference data only (document types, profiles); demo users and the simulated provider never.
if (isProduction()) await seedReferenceData();
else await seedDemo();
logger.info('seed complete');
await mongoose.disconnect();
