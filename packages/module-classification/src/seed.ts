import { DEFAULT_DOCUMENT_TYPES } from "./seed-data.js";
import { DocumentTypeModel } from "./models.js";

/**
 * Inserts the default types. Uses $setOnInsert, so re-running never overwrites
 * anything an admin has edited.
 */
export async function seedDocumentTypes(): Promise<number> {
  const results = await Promise.all(
    DEFAULT_DOCUMENT_TYPES.map((t) =>
      DocumentTypeModel.updateOne(
        { code: t.code },
        { $setOnInsert: t },
        { upsert: true },
      ),
    ),
  );
  return results.filter((res) => res.upsertedCount === 1).length;
}
