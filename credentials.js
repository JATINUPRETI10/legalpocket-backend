// server/credentials.js
import fs from "fs";
import path from "path";

export function prepareGoogleCreds() {
  // If GOOGLE_SERVICE_ACCOUNT_JSON is provided (full JSON as env var),
  // write it to a temp file and set GOOGLE_APPLICATION_CREDENTIALS for Google libs.
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;

  try {
    const outPath = "/tmp/google_service_account.json";
    fs.writeFileSync(outPath, raw, { encoding: "utf8" });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = outPath;
    console.log("Wrote service account to", outPath);
    return outPath;
  } catch (err) {
    console.error("Failed writing service account JSON:", err);
    return null;
  }
}
