"use client";

import { useEffect, useRef, useState } from "react";
import type { AdminSellerApplicationDTO, SellerApplicationStatus } from "@/lib/seller-application";

const statusLabels: Record<SellerApplicationStatus, string> = {
  draft: "Draft",
  submitted: "Awaiting review",
  changes_requested: "Changes requested",
  approved: "Approved",
};
type ReviewFilter = "all" | "submitted" | "changes_requested" | "approved";

function displayDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value)) : "—";
}

async function fetchApplications(): Promise<AdminSellerApplicationDTO[]> {
  const response = await fetch("/api/admin/seller-applications", { cache: "no-store" });
  if (response.status === 401) throw new Error("Your session has ended. Sign in again to review applications.");
  if (response.status === 403) throw new Error("Your account no longer has permission to review seller applications.");
  if (!response.ok) throw new Error("Applications could not be refreshed. Please try again.");
  const data = await response.json() as { applications: AdminSellerApplicationDTO[] };
  return data.applications;
}

export function SellerApplicationReview({ initialApplications, reviewerEmail }: {
  initialApplications: AdminSellerApplicationDTO[];
  reviewerEmail: string;
}) {
  const [applications, setApplications] = useState(initialApplications);
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [selectedId, setSelectedId] = useState(initialApplications.find(item => item.status === "submitted")?.id ?? initialApplications[0]?.id ?? "");
  const [mobileDetail, setMobileDetail] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const requestInFlight = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const filtered = applications.filter(item => filter === "all" || item.status === filter);
  const selected = applications.find(item => item.id === selectedId);
  const awaitingCount = applications.filter(item => item.status === "submitted").length;
  const selfReview = selected?.applicantEmail.toLowerCase() === reviewerEmail.toLowerCase();
  const canReview = selected?.status === "submitted" && !selfReview && !conflict;

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function selectApplication(id: string) {
    setSelectedId(id);
    setFeedback("");
    setError("");
    setNotice("");
    setConflict(false);
    setMobileDetail(true);
    requestAnimationFrame(() => detailHeadingRef.current?.focus());
  }

  function changeFilter(value: ReviewFilter) {
    const matching = applications.filter(item => value === "all" || item.status === value);
    setFilter(value);
    setSelectedId(matching.find(item => item.id === selectedId)?.id ?? matching[0]?.id ?? "");
    setFeedback("");
    setError("");
    setNotice("");
    setConflict(false);
    setMobileDetail(false);
  }

  function replaceApplications(next: AdminSellerApplicationDTO[]) {
    setApplications(next);
    const matching = next.filter(item => filter === "all" || item.status === filter);
    const nextSelectedId = matching.find(item => item.id === selectedId)?.id ?? matching[0]?.id ?? "";
    setSelectedId(nextSelectedId);
    if (nextSelectedId !== selectedId) setFeedback("");
    setConflict(false);
  }

  async function refresh() {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      replaceApplications(await fetchApplications());
      setNotice("Applications refreshed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Applications could not be refreshed. Please try again.");
    } finally {
      requestInFlight.current = false;
      setPending(false);
    }
  }

  async function review(action: "approve" | "request_changes") {
    if (!selected || !canReview || requestInFlight.current) return;
    if (action === "request_changes" && feedback.trim().length < 10) {
      setError("Explain the requested changes in at least 10 characters.");
      return;
    }
    requestInFlight.current = true;
    setPending(true);
    setError("");
    setNotice("");
    let saved = false;
    try {
      const response = await fetch(`/api/admin/seller-applications/${encodeURIComponent(selected.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, version: selected.version, feedback: feedback.trim() }),
      });
      if (response.status === 409) {
        setConflict(true);
        setError("This application changed since you opened it. Refresh applications and review the latest details before deciding.");
        return;
      }
      if (response.status === 401) throw new Error("Your session has ended. Sign in again to review applications.");
      if (response.status === 403) throw new Error("This decision is not permitted. You cannot review your own application, and administrator access is required.");
      if (response.status === 400) throw new Error("The decision could not be saved. Check your feedback and refresh the application before trying again.");
      if (!response.ok) throw new Error("The decision could not be saved. Please try again.");
      saved = true;
      setFeedback("");
      replaceApplications(await fetchApplications());
      setNotice(action === "approve"
        ? `${selected.fields.storeName} approved. Its owner can now open the local seller workspace.`
        : `Changes requested for ${selected.fields.storeName}. Your feedback is available in the applicant’s account.`);
    } catch (cause) {
      if (saved) {
        setConflict(true);
        setError("Your decision was saved, but the list could not be refreshed. Refresh applications to see the current status.");
      } else {
        setError(cause instanceof Error ? cause.message : "The decision could not be saved. Please try again.");
      }
    } finally {
      requestInFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div className="seller-review">
      <div className="ops-page-heading seller-review-heading">
        <div>
          <h1>Seller applications</h1>
          <p>{awaitingCount === 0 ? "No applications are awaiting review." : `${awaitingCount} ${awaitingCount === 1 ? "application is" : "applications are"} awaiting review.`}</p>
        </div>
        <button className="seller-review-button" type="button" disabled={pending} onClick={refresh}>{pending ? "Please wait…" : "Refresh applications"}</button>
      </div>

      {error && <div className="seller-review-message is-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</div>}
      {notice && <p className="seller-review-message" role="status">{notice}</p>}

      <div className={`seller-review-grid${mobileDetail ? " is-detail-open" : ""}`}>
        <section className="seller-review-list" aria-labelledby="application-list-heading" aria-busy={pending}>
          <div className="seller-review-list-heading">
            <h2 id="application-list-heading" tabIndex={-1} ref={listHeadingRef}>Applications <span>{filtered.length}</span></h2>
            <label htmlFor="application-filter">Review status</label>
            <select id="application-filter" value={filter} disabled={pending} onChange={event => changeFilter(event.target.value as ReviewFilter)}>
              <option value="all">All applications</option>
              <option value="submitted">Awaiting review</option>
              <option value="changes_requested">Changes requested</option>
              <option value="approved">Approved</option>
            </select>
          </div>
          {filtered.length ? (
            <ul>
              {filtered.map(application => (
                <li key={application.id}>
                  <button type="button" disabled={pending} aria-pressed={selectedId === application.id} className={`seller-review-row${selectedId === application.id ? " is-selected" : ""}`} onClick={() => selectApplication(application.id)}>
                    <strong>{application.fields.storeName || "Store name not provided"}</strong>
                    <span className="seller-review-row-applicant">{application.applicantName}</span>
                    <span className="seller-review-row-meta"><span className={`seller-review-status is-${application.status}`}>{statusLabels[application.status]}</span><time dateTime={application.submittedAt ?? undefined}>{displayDate(application.submittedAt)}</time></span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <div className="seller-review-empty"><h3>{applications.length ? "No matching applications" : "No applications yet"}</h3><p>{applications.length ? "Choose another review status to see the other applications." : "New applications appear here after their first submission. Before then, drafts stay private."}</p></div>}
        </section>

        <section className="seller-review-detail" aria-labelledby="application-detail-heading" aria-busy={pending}>
          <button className="seller-review-back" type="button" disabled={pending} onClick={() => {
            setMobileDetail(false);
            requestAnimationFrame(() => listHeadingRef.current?.focus());
          }}>← Back to applications</button>
          {selected ? <>
            <div className="seller-review-detail-heading">
              <h2 id="application-detail-heading" tabIndex={-1} ref={detailHeadingRef}>{selected.fields.storeName || "Store name not provided"}</h2>
              <span className={`seller-review-status is-${selected.status}`}>{statusLabels[selected.status]}</span>
            </div>
            <dl className="seller-review-facts">
              <div><dt>Applicant</dt><dd>{selected.applicantName}<span>{selected.applicantEmail}</span></dd></div>
              <div><dt>Store contact</dt><dd>{selected.fields.contactName || "Not provided"}</dd></div>
              <div><dt>Category</dt><dd>{selected.fields.category || "Not provided"}</dd></div>
              <div><dt>Location</dt><dd>{[selected.fields.city, selected.fields.state, "United States"].filter(Boolean).join(", ")}</dd></div>
              <div><dt>Submitted</dt><dd>{displayDate(selected.submittedAt)}</dd></div>
              <div><dt>Last reviewed</dt><dd>{displayDate(selected.reviewedAt)}</dd></div>
              <div className="seller-review-wide"><dt>Website</dt><dd>{selected.fields.website || "Not provided"}</dd></div>
            </dl>
            <div className="seller-review-description"><h3>About the store</h3><p>{selected.fields.description || "No store description provided."}</p></div>
            {selected.feedback && <div className="seller-review-feedback"><h3>Previous review feedback</h3><p>{selected.feedback}</p></div>}

            {selected.status === "submitted" ? <div className="seller-review-decision">
              <h3>Review decision</h3>
              <p>Approval gives this applicant access to their local seller workspace. It does not publish a storefront or activate payments.</p>
              {selfReview ? <p className="seller-review-message">Another administrator must review your application.</p> : <>
                <label htmlFor="review-feedback">Feedback for the applicant</label>
                <textarea id="review-feedback" rows={4} maxLength={2000} value={feedback} disabled={pending || conflict} aria-describedby="review-feedback-help" onChange={event => setFeedback(event.target.value)} />
                <p id="review-feedback-help">Optional with approval. To request changes, explain what to update in 10–2,000 characters. Feedback appears in the applicant’s account.</p>
                <div className="seller-review-actions">
                  <button className="seller-review-button is-primary" type="button" disabled={pending || !canReview} onClick={() => review("approve")}>Approve application</button>
                  <button className="seller-review-button" type="button" disabled={pending || !canReview || feedback.trim().length < 10} onClick={() => review("request_changes")}>Request changes</button>
                </div>
              </>}
            </div> : <p className="seller-review-outcome">{selected.status === "approved" ? "Approved. The applicant can access their local seller workspace." : "Saved updates are visible here while the applicant makes changes. A new decision becomes available only after they resubmit."}</p>}
          </> : <div className="seller-review-empty"><h2 id="application-detail-heading">Application details</h2><p>Select a submitted application to review the store and make a decision.</p></div>}
        </section>
      </div>
    </div>
  );
}
