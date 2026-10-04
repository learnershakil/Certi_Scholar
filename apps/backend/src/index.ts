// --------------- VAIBHAV TYAGI WORK ----------------
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { connectDB } from './config/db';
import documentRoutes from './routes/documents';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

app.use(express.json());

// Create quarantine dir
const quarantinePath = path.resolve(__dirname, '../../../quarantine');
if (!fs.existsSync(quarantinePath)) {
  fs.mkdirSync(quarantinePath, { recursive: true });
}

// Routes
app.use('/api/documents', documentRoutes);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

const PORT = process.env.PORT || 3001;

const startServer = async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`[Backend] API Server running on port ${PORT}`);
  });
};

startServer().catch(err => {
  console.error('[Backend] Fatal error', err);
  process.exit(1);
});

