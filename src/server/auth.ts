import "server-only";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { z } from "zod";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { appOrigins } from "./app-origin";
import { trustedIpHeaders } from "./client-ip";
import { db } from "./db";
import * as schema from "./schema";

export const auth = betterAuth({
  appName: "Cartiva",
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: appOrigins(),
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    // Delivery/verification is a later integration; never mark local signups verified.
    requireEmailVerification: false,
  },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "customer", required: false, input: false },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const name = z.string().trim().min(2).max(100).safeParse(user.name);
          if (!name.success) throw new APIError("BAD_REQUEST", { message: "Enter a name between 2 and 100 characters." });
          return { data: { ...user, name: name.data } };
        },
      },
      update: {
        before: async (user) => {
          if (user.name === undefined) return;
          const name = z.string().trim().min(2).max(100).safeParse(user.name);
          if (!name.success) throw new APIError("BAD_REQUEST", { message: "Enter a name between 2 and 100 characters." });
          return { data: { ...user, name: name.data } };
        },
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: false },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
    },
  },
  advanced: {
    disableOriginCheck: false,
    // Locally the headers are client-controlled and ignored; on Vercel they come
    // from its edge, so rate limits become per visitor instead of shared.
    ipAddress: { ipAddressHeaders: trustedIpHeaders },
  },
});
