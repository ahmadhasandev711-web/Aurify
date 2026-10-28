// Better Auth (D-08): email + password, DB-backed sessions (so disabling a member can revoke
// their sessions immediately). Sign-up is closed: users are created only by accepting an
// Owner's invitation (72h, single use), never through the public endpoint.

import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { db } from './db';

function createAuth() {
  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: prismaAdapter(db as never, { provider: 'postgresql' }),

    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },

    session: {
      modelName: 'session',
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },

    // Our Prisma models: User, Session, AuthAccount (not "Account": that is the tenant), Verification.
    user: { modelName: 'user' },
    account: {
      modelName: 'authAccount',
      fields: { accountId: 'providerAccountId' },
    },
    verification: { modelName: 'verification' },

    plugins: [nextCookies()],

  });
}

// Lazy: the Prisma adapter inspects the client on construction, which must not happen at build time.
let instance: ReturnType<typeof createAuth> | undefined;
export const getAuth = () => (instance ??= createAuth());
