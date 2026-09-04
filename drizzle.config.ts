import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL ?? "file:./data/app.db";
const sqlitePath = url.startsWith("file:") ? url.slice("file:".length) : url;

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: sqlitePath,
  },
  strict: true,
  verbose: true,
});
