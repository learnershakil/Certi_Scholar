// --------------- VAIBHAV TYAGI WORK ----------------
import { Router } from 'express';
import { uploadDocument, getDocumentStatus, getDocumentAccess, getDocuments } from '../controllers/documentController';
import multer from 'multer';
import path from 'path';

const router = Router();

// Minimal auth middleware for testing
import { authenticate } from '../middlewares/auth';

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.resolve(__dirname, '../../../../quarantine'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

router.use(authenticate);

router.post('/upload', upload.single('file'), uploadDocument);
router.get('/', getDocuments);
router.get('/:id/status', getDocumentStatus);
router.get('/:id/access', getDocumentAccess);

// For local testing ONLY: a route to fetch the file securely if token is valid
import { getStorageProvider, LocalStorageProvider } from '../services/storage';
router.get('/local-access/:token', async (req, res) => {
  const token = req.params.token;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const [key, expires, signature] = decoded.split(':');
    
    if (!key || !expires || !signature) {
      return res.status(403).json({ error: 'Malformed token' });
    }

    if (Date.now() > parseInt(expires, 10)) {
      return res.status(403).json({ error: 'Link expired' });
    }

    const dataToVerify = `${key}:${expires}`;
    const secret = process.env.JWT_SECRET || 'fallback-secret-key-do-not-use-in-production';
    const crypto = await import('crypto');
    const expectedSignature = crypto.createHmac('sha256', secret).update(dataToVerify).digest('hex');

    if (signature !== expectedSignature) {
      return res.status(403).json({ error: 'Invalid signature' });
    }

    if (key.includes('..') || key.startsWith('/')) {
      return res.status(403).json({ error: 'Invalid storage key' });
    }

    const provider = getStorageProvider();
    if (provider instanceof LocalStorageProvider) {
      const localProvider = provider as LocalStorageProvider;
      const filePath = path.join(localProvider.basePath, key);
      res.sendFile(filePath);
    } else {
      res.status(400).json({ error: 'Not using local storage' });
    }
  } catch (err) {
    res.status(403).json({ error: 'Invalid token' });
  }
});

export default router;
