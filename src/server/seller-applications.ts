import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import type { z } from "zod";
import type { AdminSellerApplicationDTO, SellerApplicationDTO, SellerStoreDTO, sellerMutationSchema, sellerReviewSchema } from "../lib/seller-application";
import { hasPermission } from "../lib/permissions";
import { db } from "./db";
import { demoMode, maskEmail } from "./demo";
import { auditEvent, sellerApplication, sellerStore, user } from "./schema";

export class SellerApplicationError extends Error {
  constructor(public status: number, message: string, public fieldErrors?: Record<string, string>) {
    super(message);
  }
}

function applicationDTO(row: typeof sellerApplication.$inferSelect): SellerApplicationDTO {
  return {
    id: row.id, status: row.status, version: row.version, fields: row.fields, feedback: row.feedback,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    submittedAt: row.submittedAt?.toISOString() ?? null, reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

export async function getOwnSellerApplication(userId: string): Promise<SellerApplicationDTO | null> {
  const [row] = await db.select().from(sellerApplication).where(eq(sellerApplication.userId, userId)).limit(1);
  return row ? applicationDTO(row) : null;
}

// Callers must enforce vendors:review before requesting the review queue.
// In the public demo (shared admin account) applicant emails are masked.
export async function listSellerApplications(): Promise<AdminSellerApplicationDTO[]> {
  const rows = await db.select({ application: sellerApplication, applicantName: user.name, applicantEmail: user.email })
    .from(sellerApplication).innerJoin(user, eq(user.id, sellerApplication.userId))
    .where(ne(sellerApplication.status, "draft")).orderBy(desc(sellerApplication.updatedAt));
  const hide = demoMode();
  return rows.map(row => ({
    ...applicationDTO(row.application), applicantName: row.applicantName,
    applicantEmail: hide ? maskEmail(row.applicantEmail) : row.applicantEmail,
  }));
}

export async function getOwnSellerStore(userId: string): Promise<SellerStoreDTO | null> {
  const [row] = await db.select().from(sellerStore).where(eq(sellerStore.ownerId, userId)).limit(1);
  return row ? {
    id: row.id, applicationId: row.applicationId, ownerId: row.ownerId, name: row.name,
    fields: row.fields, country: "US", createdAt: row.createdAt.toISOString(),
  } : null;
}

export async function saveSellerApplication(userId: string, command: z.infer<typeof sellerMutationSchema>): Promise<SellerApplicationDTO> {
  return db.transaction(async tx => {
    // Lock the applicant before their application in every write path. This also
    // serializes the first insert, where there is no application row to lock yet.
    const [applicant] = await tx.select().from(user).where(eq(user.id, userId)).for("update");
    if (!applicant || applicant.role !== "customer") {
      throw new SellerApplicationError(403, "Only customer accounts can apply to sell.");
    }
    const [existing] = await tx.select().from(sellerApplication).where(eq(sellerApplication.userId, userId)).for("update");
    if ((existing?.version ?? 0) !== command.version) {
      throw new SellerApplicationError(409, "Your application changed. Reload it before saving again.");
    }
    if (existing && existing.status !== "draft" && existing.status !== "changes_requested") {
      throw new SellerApplicationError(409, "This application is no longer open for editing.");
    }
    const now = new Date();
    const status = command.action === "submit" ? "submitted" : (existing?.status ?? "draft");
    const values = {
      fields: command.fields, status, version: command.version + 1, updatedAt: now,
      submittedAt: command.action === "submit" ? now : (existing?.submittedAt ?? null),
    } as const;
    const [saved] = existing
      ? await tx.update(sellerApplication).set(values)
        .where(and(eq(sellerApplication.id, existing.id), eq(sellerApplication.version, command.version))).returning()
      : await tx.insert(sellerApplication).values({ id: randomUUID(), userId, ...values }).returning();
    if (!saved) throw new SellerApplicationError(409, "Your application changed. Reload it before saving again.");
    if (command.action === "submit") {
      await tx.insert(auditEvent).values({ id: randomUUID(), actorId: userId, action: "seller_application.submitted", subjectId: saved.id });
    }
    return applicationDTO(saved);
  });
}

export async function reviewSellerApplication(actorId: string, applicationId: string, command: z.infer<typeof sellerReviewSchema>): Promise<SellerApplicationDTO> {
  return db.transaction(async tx => {
    const [candidate] = await tx.select({ userId: sellerApplication.userId }).from(sellerApplication).where(eq(sellerApplication.id, applicationId));
    if (!candidate) throw new SellerApplicationError(404, "Application not found.");
    if (candidate.userId === actorId) throw new SellerApplicationError(403, "You cannot review your own application.");
    await tx.select({ id: user.id }).from(user).where(eq(user.id, candidate.userId)).for("update");
    const [actor] = await tx.select({ role: user.role }).from(user).where(eq(user.id, actorId));
    if (!actor || !hasPermission(actor.role, "vendors:review")) throw new SellerApplicationError(403, "You do not have access to review seller applications.");
    const [application] = await tx.select().from(sellerApplication).where(eq(sellerApplication.id, applicationId)).for("update");
    if (!application || application.version !== command.version || application.status !== "submitted") {
      throw new SellerApplicationError(409, "This application changed or has already been reviewed. Reload the queue.");
    }
    const now = new Date();
    const [reviewed] = await tx.update(sellerApplication).set({
      status: command.action === "approve" ? "approved" : "changes_requested",
      version: command.version + 1, feedback: command.feedback, reviewedAt: now, updatedAt: now,
    }).where(and(eq(sellerApplication.id, applicationId), eq(sellerApplication.version, command.version), eq(sellerApplication.status, "submitted"))).returning();
    if (!reviewed) throw new SellerApplicationError(409, "This application has already been reviewed. Reload the queue.");
    if (command.action === "approve") {
      await tx.insert(sellerStore).values({
        id: randomUUID(), ownerId: application.userId, applicationId, name: application.fields.storeName, fields: application.fields,
      });
      // An independently granted staff/admin role must never be overwritten.
      await tx.update(user).set({ role: "vendor_owner", updatedAt: now })
        .where(and(eq(user.id, application.userId), eq(user.role, "customer")));
    }
    await tx.insert(auditEvent).values({ id: randomUUID(), actorId, action: `seller_application.${command.action === "approve" ? "approved" : "changes_requested"}`, subjectId: applicationId });
    return applicationDTO(reviewed);
  });
}
