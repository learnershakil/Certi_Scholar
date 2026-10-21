import { runAcademicCheck } from "@repo/academic-engine";
import { parseAcademicRecord } from "../../../lib/academic/parse-record";

/**
 * POST /api/academic-check
 *
 * Request body : an AcademicRecord as JSON
 * 200          : the engine's AcademicEngineResult, unchanged
 * 400          : { error, details? } for non-JSON or wrongly shaped bodies
 * 500          : { error } generic message for unexpected failures
 *
 * All calculation and consistency decisions are made by runAcademicCheck().
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = parseAcademicRecord(body);

  if (!parsed.ok) {
    return Response.json(
      { error: "Invalid academic record.", details: parsed.errors },
      { status: 400 },
    );
  }

  try {
    const result = runAcademicCheck(parsed.record);
    return Response.json(result);
  } catch (error) {
    // Log details on the server only; never send them to the client.
    console.error("academic-check failed:", error);
    return Response.json(
      { error: "The academic check could not be completed." },
      { status: 500 },
    );
  }
}