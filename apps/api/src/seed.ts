import mongoose from 'mongoose';
import { config } from './config.js';
import { logger } from './lib/events.js';
import { seedDemo, seedReferenceData, seedScholarships } from './seedData.js';

const c = config();
await mongoose.connect(c.MONGO_URL);
// Reference data and scholarships always; demo accounts and the simulated provider only with SEED_DEMO=true,
// which the configuration refuses in production.
if (c.SEED_DEMO) {
  await seedDemo();
} else {
  await seedReferenceData();
  await seedScholarships();
}
logger.info({ demo: c.SEED_DEMO }, 'seed complete');
await mongoose.disconnect();
