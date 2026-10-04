import { Router, json, type ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import type { OcrTextProvider } from "./adapters.js";
import {
  ClassifyRequest,
  DocumentTypeInput,
  ManualClassificationRequest,
  OcrCompletedEvent,
} from "./contracts.js";
import { ConflictError, NotFoundError, type ClassificationService } from "./service.js";

export interface ClassificationRouterOptions {
  service: ClassificationService;
  ocrTextProvider: OcrTextProvider;
}

/**
 * Express router. Mount it from the API gateway with app.use(router).
 * Authentication/role checks (student / officer / admin) belong to the gateway;
 * add them as middleware in front of this router when auth exists.
 *
 * Express 5 forwards rejected promises from async handlers to the error
 * middleware automatically, so handlers don't need try/catch.
 */
export function createClassificationRouter(opts: ClassificationRouterOptions): Router {
  const { service, ocrTextProvider } = opts;
  const router = Router();
  router.use(json());

  // Direct call with an OcrCompletedEvent: use this for testing before M2 exists.
  router.post("/internal/classify", async (req, res) => {
    const event = OcrCompletedEvent.parse(req.body);
    res.json(await service.run(event, { force: true }));
  });

  router.get("/documents/:id/classification", async (req, res) => {
    const result = await service.get(req.params.id);
    if (!result) throw new NotFoundError("No classification for this document");
    res.json(result);
  });

  // Retry / reprocess. Idempotent.
  router.post("/documents/:id/classify", async (req, res) => {
    const body = ClassifyRequest.parse(req.body ?? {});
    const text = body.text ?? (await ocrTextProvider.getText(req.params.id));
    if (text == null) {
      res.status(422).json({
        error: "no_ocr_text",
        message: "Send { text } in the body, or wire an OcrTextProvider from M2.",
      });
      return;
    }
    res.json(
      await service.run({ version: "1", documentId: req.params.id, text }, { force: body.force }),
    );
  });

  // Reviewer sets the type manually (M5 will call this and own the audit UI).
  router.patch("/documents/:id/classification", async (req, res) => {
    const body = ManualClassificationRequest.parse(req.body);
    res.json(await service.setManual(req.params.id, body));
  });

  // Admin CRUD for document types.
  router.get("/document-types", async (_req, res) => {
    res.json(await service.listTypes());
  });
  router.get("/document-types/:code", async (req, res) => {
    res.json(await service.getType(req.params.code));
  });
  router.post("/document-types", async (req, res) => {
    res.status(201).json(await service.createType(DocumentTypeInput.parse(req.body)));
  });
  router.put("/document-types/:code", async (req, res) => {
    res.json(await service.updateType(req.params.code, DocumentTypeInput.parse(req.body)));
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: "validation_error", issues: err.issues });
    } else if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
    } else if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message });
    } else if ((err as { type?: string })?.type === "entity.parse.failed") {
      res.status(400).json({ error: "invalid_json" });
    } else {
      console.error("[classification] unhandled error", err);
      res.status(500).json({ error: "internal_error" });
    }
  };
  router.use(onError);

  return router;
}
