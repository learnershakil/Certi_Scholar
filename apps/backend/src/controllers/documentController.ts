// --------------- VAIBHAV TYAGI WORK ----------------
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { DocumentModel } from '../models/Document';
import { AuditLogModel } from '../models/AuditLog';
import { documentScanQueue } from '../services/queue';
import { getStorageProvider } from '../services/storage';
import { validateFile } from '../services/validator';
import fs from 'fs';

export const uploadDocument = async (req: Request, res: Response) => {
  try {
    const file = req.file;
    const requestedType = req.body.requestedType;
    const applicationId = req.body.applicationId;
    const user = req.user!;

    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }
    if (!requestedType) {
      // Clean up temp file
      fs.unlinkSync(file.path);
      return res.status(400).json({ error: 'requestedType is required' });
    }

    // 1. Independent Server Validation
    const validationResult = await validateFile(file.path, file.originalname, file.mimetype);
    if (!validationResult.valid) {
      fs.unlinkSync(file.path);
      return res.status(400).json({ error: validationResult.error });
    }

    // 2. Check Idempotency / Duplicate
    // If exact same file content (checksum) is uploaded by same user for same requestedType, return existing.
    const existing = await DocumentModel.findOne({
      ownerId: user.id,
      checksum: validationResult.checksum,
      requestedType,
    });

    if (existing) {
      fs.unlinkSync(file.path);
      return res.status(200).json({
        message: 'File already exists',
        documentId: existing.documentId,
        status: existing.status
      });
    }

    // 3. Create Document Record
    const documentId = uuidv4();
    const storageKey = `${user.id}/${uuidv4()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

    const document = new DocumentModel({
      documentId,
      ownerId: user.id,
      applicationId,
      originalFilename: file.originalname,
      storageKey,
      mimeType: validationResult.mimeType, // Use validated MIME, not client provided
      sizeBytes: file.size,
      checksum: validationResult.checksum,
      requestedType,
      status: 'quarantined'
    });

    await document.save();

    await AuditLogModel.create({
      documentId,
      actorId: user.id,
      action: 'UPLOADED',
    });

    // 4. Enqueue Scan Job
    await documentScanQueue.add('scan', {
      documentId,
      filePath: file.path,
      mimeType: validationResult.mimeType
    }, {
      removeOnComplete: true,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 }
    });

    res.status(202).json({
      message: 'Upload accepted and queued for security scan',
      documentId,
      status: 'quarantined'
    });

  } catch (error: any) {
    console.error('Upload Error:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getDocuments = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    // In real app, officers can see based on application access.
    // For now, students see theirs. Officers see all.
    const query = user.role === 'officer' ? {} : { ownerId: user.id };
    
    const docs = await DocumentModel.find(query)
      .select('-_id documentId originalFilename requestedType status sizeBytes createdAt')
      .sort({ createdAt: -1 });

    res.status(200).json(docs);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getDocumentStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    const document = await DocumentModel.findOne({ documentId: id });
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (user.role !== 'officer' && document.ownerId !== user.id) {
      return res.status(403).json({ error: 'Unauthorized access' });
    }

    res.status(200).json({
      documentId: document.documentId,
      status: document.status,
      originalFilename: document.originalFilename,
      requestedType: document.requestedType,
      scanDetails: document.scanDetails,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getDocumentAccess = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    const document = await DocumentModel.findOne({ documentId: id });
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (user.role !== 'officer' && document.ownerId !== user.id) {
      await AuditLogModel.create({
        documentId: id,
        actorId: user.id,
        action: 'ACCESS_DENIED'
      });
      return res.status(403).json({ error: 'Unauthorized access' });
    }

    const allowedStatuses = ['clean', 'queued', 'processing', 'completed'];
    if (!allowedStatuses.includes(document.status)) {
      return res.status(400).json({ error: `Cannot access document in status: ${document.status}` });
    }

    const storage = getStorageProvider();
    
    if (!(await storage.exists(document.storageKey))) {
      return res.status(404).json({ error: 'Document binary missing in storage' });
    }

    const signedUrl = await storage.getSignedUrl(document.storageKey, 300); // 5 mins

    await AuditLogModel.create({
      documentId: id,
      actorId: user.id,
      action: 'ACCESS_GRANTED'
    });

    res.status(200).json({ url: signedUrl, expires: 300 });

  } catch (error) {
    console.error('Access error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

