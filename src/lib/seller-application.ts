import { z } from "zod";

export const sellerCategories = ["Home & living", "Tech", "Everyday carry"] as const;
export const usStates = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"] as const;

export type SellerApplicationFields = {
  storeName: string;
  contactName: string;
  category: string;
  description: string;
  city: string;
  state: string;
  website: string;
};

export const emptySellerFields: SellerApplicationFields = {
  storeName: "", contactName: "", category: "", description: "", city: "", state: "", website: "",
};

export type SellerApplicationStatus = "draft" | "submitted" | "changes_requested" | "approved";
export type SellerApplicationDTO = {
  id: string;
  status: SellerApplicationStatus;
  version: number;
  fields: SellerApplicationFields;
  feedback: string;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
};
export type AdminSellerApplicationDTO = SellerApplicationDTO & { applicantName: string; applicantEmail: string };
export type SellerStoreDTO = {
  id: string;
  applicationId: string;
  ownerId: string;
  name: string;
  fields: SellerApplicationFields;
  country: "US";
  createdAt: string;
};

export const draftFieldsSchema = z.strictObject({
  storeName: z.string().trim().max(80, "Use 80 characters or fewer."),
  contactName: z.string().trim().max(80, "Use 80 characters or fewer."),
  category: z.string().trim().max(40),
  description: z.string().trim().max(2000, "Use 2,000 characters or fewer."),
  city: z.string().trim().max(80, "Use 80 characters or fewer."),
  state: z.string().trim().max(2),
  website: z.string().trim().max(300, "Use 300 characters or fewer."),
});

export const submittedFieldsSchema = draftFieldsSchema.extend({
  storeName: z.string().trim().min(2, "Enter a store name with at least 2 characters.").max(80),
  contactName: z.string().trim().min(2, "Enter a contact name with at least 2 characters.").max(80),
  category: z.enum(sellerCategories, { error: "Choose a store category." }),
  description: z.string().trim().min(30, "Tell us about your store in at least 30 characters.").max(2000),
  city: z.string().trim().min(2, "Enter your city.").max(80),
  state: z.enum(usStates, { error: "Choose a US state." }),
  website: z.string().trim().max(300).refine(value => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
    } catch { return false; }
  }, "Enter a full HTTPS website address, or leave it empty."),
});

export const sellerMutationSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("save"), version: z.number().int().nonnegative(), fields: draftFieldsSchema }),
  z.strictObject({ action: z.literal("submit"), version: z.number().int().nonnegative(), fields: submittedFieldsSchema }),
]);

export const sellerReviewSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("approve"), version: z.number().int().positive(), feedback: z.string().trim().max(2000) }),
  z.strictObject({ action: z.literal("request_changes"), version: z.number().int().positive(), feedback: z.string().trim().min(10, "Explain the requested changes in at least 10 characters.").max(2000) }),
]);
