// Vercel project configuration.
// Replaces vercel.json with full TypeScript support.

export const config = {
  buildCommand: "next build",
  framework: "nextjs",
  crons: [
    {
      path: "/api/cron/refresh-fx",
      schedule: "0 5 * * *",
    },
  ],
} as const;
