import type { CorsOptions } from "cors";
import { env } from "./env";

// Browsers send the Origin header without a trailing slash, so "https://site.com/" (as
// copied from a console) must still match.
const allowedOrigins = env.FRONTEND_ORIGIN.split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin is not allowed by CORS: ${origin}`));
  },
  credentials: true,
};
