import type { Config } from 'drizzle-kit'

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://opensignage:opensignage@localhost:5432/opensignage',
  },
  verbose: true,
  strict: true,
} satisfies Config
