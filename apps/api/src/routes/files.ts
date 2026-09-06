import { Router } from 'express';
import { config } from '../config.js';
import { DocumentModel } from '../models/document.js';
import { DocumentAccessLogModel } from '../models/system.js';
import { verifyAccessToken } from '../lib/crypto.js';
import { blobStore } from '../lib/storage.js';
import { actor } from '../lib/http.js';
import { HttpError } from '../lib/errors.js';

export const files = Router();

/** Serves decrypted content for a valid, unexpired token bound to the requesting user. Every view is logged. */
files.get('/:token', async (req, res) => {
  const me = actor(req);
  const claims = verifyAccessToken(req.params.token, config().PRESIGN_SECRET);
  if (!claims || claims.userId !== me.id) throw new HttpError(403, 'link_invalid', 'This link is invalid or has expired');
  const doc = await DocumentModel.findById(claims.documentId).lean();
  const key = claims.variant === 'preview' ? doc?.previewKey ?? doc?.storageKey : doc?.storageKey;
  if (!doc || !key) throw new HttpError(410, 'gone', 'The document is no longer available');

  const data = await blobStore().get(key);
  await DocumentAccessLogModel.create({ document: doc._id, actor: me.id, actorRole: me.role, variant: claims.variant, ip: req.ip, userAgent: req.get('user-agent') });
  res
    .set({
      'Content-Type': claims.variant === 'preview' && doc.previewKey ? 'image/png' : doc.mime,
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    .send(data);
});
