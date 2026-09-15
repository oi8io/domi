export const config = {
  db: process.env.DATABASE_URL,
  port: Number(process.env.PORT ?? 3000),
  secret: process.env.SESSION_SECRET,
  debug: process.env.DEBUG === '1',
}
