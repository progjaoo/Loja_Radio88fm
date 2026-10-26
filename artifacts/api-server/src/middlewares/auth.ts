import { clerkClient, getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import type { RequestHandler } from "express";
import { db, profilesTable, type Profile } from "@workspace/db";
import { ensureLegacyStoreRole, getStorePermissionKeys } from "../lib/rbac";

export async function ensureStoreProfile(userId: string): Promise<Profile> {
  const [existing] = await db.select().from(profilesTable).where(eq(profilesTable.userId, userId)).limit(1);
  if (existing) {
    await ensureLegacyStoreRole(existing);
    return existing;
  }

  const identity = await clerkClient.users.getUser(userId);
  const emailRecord =
    identity.emailAddresses.find((item) => item.id === identity.primaryEmailAddressId) ??
    identity.emailAddresses[0];
  const email = emailRecord?.emailAddress?.trim().toLowerCase();
  if (!email) throw new Error("A verified email address is required to create a store profile.");

  const verified = emailRecord.verification?.status === "verified";
  const configuredAdminEmail = process.env.STORE_ADMIN_EMAIL?.trim().toLowerCase();
  const role = verified && configuredAdminEmail === email ? "admin" : "customer";
  const fullName =
    [identity.firstName, identity.lastName].filter(Boolean).join(" ").trim() ||
    email.split("@")[0] ||
    "Cliente Rádio 88";

  await db
    .insert(profilesTable)
    .values({ userId, email, fullName, role })
    .onConflictDoNothing();

  const [created] = await db.select().from(profilesTable).where(eq(profilesTable.userId, userId)).limit(1);
  if (!created) throw new Error("The store profile could not be provisioned.");
  await ensureLegacyStoreRole(created);
  return created;
}

export const requireStoreAuth: RequestHandler = async (req, res, next): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign-in required." });
    return;
  }

  try {
    res.locals.storeProfile = await ensureStoreProfile(userId);
    next();
  } catch (error) {
    next(error);
  }
};

export function requireStorePermission(...requiredPermissions: string[]): RequestHandler {
  if (!requiredPermissions.length) throw new Error("At least one store permission must be required.");
  return async (_req, res, next): Promise<void> => {
    const profile = res.locals.storeProfile as Profile | undefined;
    if (!profile) {
      res.status(401).json({ error: "Sign-in required." });
      return;
    }
    try {
      const permissions = await getStorePermissionKeys(profile.userId);
      const missing = requiredPermissions.filter((permission) => !permissions.includes(permission));
      if (missing.length) {
        res.status(403).json({
          error: "Você não tem permissão para realizar esta operação.",
          code: "INSUFFICIENT_PERMISSION",
          requiredPermissions,
        });
        return;
      }
      res.locals.storePermissions = permissions;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAnyStorePermission(...requiredPermissions: string[]): RequestHandler {
  if (!requiredPermissions.length) throw new Error("At least one store permission must be required.");
  return async (_req, res, next): Promise<void> => {
    const profile = res.locals.storeProfile as Profile | undefined;
    if (!profile) {
      res.status(401).json({ error: "Sign-in required." });
      return;
    }
    try {
      const permissions = await getStorePermissionKeys(profile.userId);
      if (!requiredPermissions.some((permission) => permissions.includes(permission))) {
        res.status(403).json({
          error: "Você não tem permissão para realizar esta operação.",
          code: "INSUFFICIENT_PERMISSION",
          requiredPermissions,
        });
        return;
      }
      res.locals.storePermissions = permissions;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function getStoreProfile(res: { locals: Record<string, unknown> }): Profile {
  const profile = res.locals.storeProfile as Profile | undefined;
  if (!profile) throw new Error("Authenticated store profile was not attached to the request.");
  return profile;
}

