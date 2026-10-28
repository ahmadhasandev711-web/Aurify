// Turns a Better Auth session into a tenant context (D-19). This is the single place where
// the web app learns which account a request belongs to — from the session, never from input.

import { headers } from 'next/headers';
import { authorize, type Action, type Role } from '@/modules/identity';
import { getAuth } from './auth';
import { db } from './db';
import { runWithTenant, withSystemContext } from './tenant/context';

export interface CurrentMember {
  userId: string;
  membershipId: string;
  accountId: string;
  role: Role;
  isPlatformAdmin: boolean;
}

/**
 * MVP: a user belongs to one account. If they ever have several active memberships we take the
 * oldest and an account switcher becomes a later decision (logged in the changelog).
 */
export async function getCurrentMember(): Promise<CurrentMember | null> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;

  // Membership is tenant-scoped, but we do not know the tenant yet — that is what we are resolving.
  const membership = await withSystemContext('resolve membership from session', () =>
    db.membership.findFirst({
      where: { userId: session.user.id, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    }),
  );
  const isPlatformAdmin = Boolean((session.user as { isPlatformAdmin?: boolean }).isPlatformAdmin);
  if (!membership) return null;

  return {
    userId: session.user.id,
    membershipId: membership.id,
    accountId: membership.accountId,
    role: membership.role,
    isPlatformAdmin,
  };
}

export class UnauthenticatedError extends Error {
  constructor() {
    super('Unauthenticated');
    this.name = 'UnauthenticatedError';
  }
}

/**
 * Every server action / route handler that touches tenant data goes through this:
 * resolve the member, check the action's permission, then run `fn` inside the tenant context.
 */
export async function withMember<T>(action: Action, fn: (member: CurrentMember) => Promise<T>): Promise<T> {
  const member = await getCurrentMember();
  if (!member) throw new UnauthenticatedError();
  authorize({ role: member.role, status: 'ACTIVE' }, action);
  return runWithTenant(member.accountId, () => fn(member));
}
