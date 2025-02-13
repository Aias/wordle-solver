import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./data/schema.ts",
  out: "./data/migrations",
  dbCredentials: {
    url: "./data/sqlite.db",
  },
  migrations: {
    table: "drizzle",
    schema: "public",
  },
});
