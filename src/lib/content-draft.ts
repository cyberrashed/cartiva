export type ContentSection = "contexts" | "catalog" | "footer";
export type ContentDraft = {
  heading: string;
  description: string;
  action: string;
  sections: { id: ContentSection; visible: boolean }[];
};

export type ContentSnapshot = {
  version: 1;
  draft: ContentDraft;
  published: ContentDraft;
  savedAt: string | null;
  publishedAt: string | null;
};

export const CONTENT_STORAGE_KEY = "cartiva:content-preview:v1";
export const CONTENT_LIMITS = { heading: 32, description: 140, action: 28 };
export const CONTENT_FIELDS = { heading: "Hero heading", description: "Supporting copy", action: "Action label" };

export const DEFAULT_CONTENT: ContentDraft = {
  heading: "Good things. Every day.",
  description: "Considered finds for your home, your desk, and everywhere in between.",
  action: "Explore the collection",
  sections: [
    { id: "contexts", visible: true },
    { id: "catalog", visible: true },
    { id: "footer", visible: true },
  ],
};

export function validateContent(draft: ContentDraft) {
  const errors: Partial<Record<keyof typeof CONTENT_FIELDS, string>> = {};
  for (const field of Object.keys(CONTENT_FIELDS) as (keyof typeof CONTENT_FIELDS)[]) {
    if (!draft[field].trim()) errors[field] = `${CONTENT_FIELDS[field]} is required.`;
    else if (draft[field].length > CONTENT_LIMITS[field]) errors[field] = `Use ${CONTENT_LIMITS[field]} characters or fewer (${draft[field].length} entered).`;
  }
  return errors;
}

function isContentDraft(value: unknown): value is ContentDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<ContentDraft>;
  if (typeof draft.heading !== "string" || typeof draft.description !== "string" || typeof draft.action !== "string") return false;
  if (!Array.isArray(draft.sections) || draft.sections.length !== 3) return false;
  const ids = new Set<ContentSection>();
  for (const section of draft.sections) {
    if (!section || !["contexts", "catalog", "footer"].includes(section.id) || typeof section.visible !== "boolean") return false;
    ids.add(section.id);
  }
  return ids.size === 3 && Object.keys(validateContent(draft as ContentDraft)).length === 0;
}

export function readContentSnapshot(raw: string | null): ContentSnapshot {
  if (!raw) return { version: 1, draft: DEFAULT_CONTENT, published: DEFAULT_CONTENT, savedAt: null, publishedAt: null };
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error("Invalid content snapshot");
  const snapshot = value as Partial<ContentSnapshot>;
  const validDate = (date: unknown) => date === null || (typeof date === "string" && Number.isFinite(Date.parse(date)));
  if (snapshot.version !== 1 || !isContentDraft(snapshot.draft) || !isContentDraft(snapshot.published) || !validDate(snapshot.savedAt) || !validDate(snapshot.publishedAt)) throw new Error("Invalid content snapshot");
  return snapshot as ContentSnapshot;
}
