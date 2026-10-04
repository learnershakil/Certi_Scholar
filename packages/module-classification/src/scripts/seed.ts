import mongoose from "mongoose";
import { seedDocumentTypes } from "../seed.js";

await mongoose.connect(process.env["MONGO_URL"] ?? "mongodb://localhost:27017/certischolar");
const inserted = await seedDocumentTypes();
console.log(`Seeded ${inserted} new document type(s).`);
await mongoose.disconnect();
