"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  emptySellerFields, sellerCategories, submittedFieldsSchema, usStates,
  type SellerApplicationDTO, type SellerApplicationFields,
} from "@/lib/seller-application";
import { useHydrated } from "@/lib/use-hydrated";

type FieldName = keyof SellerApplicationFields;
type FieldErrors = Partial<Record<FieldName, string>>;
type ApplicationResponse = { application?: SellerApplicationDTO | null; error?: string; fieldErrors?: FieldErrors };

const steps = ["Your store", "Location & contact", "Review"];
const fieldOrder: FieldName[] = ["storeName", "category", "description", "website", "contactName", "city", "state"];
const firstStepFields: FieldName[] = ["storeName", "category", "description", "website"];
const secondStepFields: FieldName[] = ["contactName", "city", "state"];
const statusLabels = { draft: "Draft", submitted: "Awaiting review", changes_requested: "Changes requested", approved: "Approved" };

function savedDate(value: string) {
  return `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value))} UTC`;
}

function Field({ name, label, hint, error, children }: { name: FieldName; label: string; hint?: string; error?: string; children: ReactNode }) {
  return <div className="seller-field">
    <label htmlFor={`seller-${name}`}>{label}</label>
    {children}
    {hint && <span className="seller-hint" id={`seller-${name}-hint`}>{hint}</span>}
    {error && <span className="seller-field-error" id={`seller-${name}-error`}>{error}</span>}
  </div>;
}

function ApplicationDetails({ fields, email }: { fields: SellerApplicationFields; email: string }) {
  const rows = [
    ["Store name", fields.storeName], ["Category", fields.category], ["About your store", fields.description],
    ["Website", fields.website || "Not provided"], ["Contact name", fields.contactName],
    ["Account email", email], ["City", fields.city], ["State", fields.state], ["Country", "United States"],
  ];
  return <dl className="seller-review-details">{rows.map(([label, value]) => <div key={label}>
    <dt>{label}</dt><dd>{value || <span className="muted">Not filled in</span>}</dd>
  </div>)}</dl>;
}

export function SellerApplicationForm({ initialApplication, name, email }: {
  initialApplication: SellerApplicationDTO | null;
  name: string;
  email: string;
}) {
  const initialFields = initialApplication?.fields ?? { ...emptySellerFields, contactName: name.slice(0, 80) };
  const hydrated = useHydrated();
  const [application, setApplication] = useState(initialApplication);
  const [fields, setFields] = useState(initialFields);
  const [savedFields, setSavedFields] = useState(initialFields);
  const [step, setStep] = useState(0);
  const [pending, setPending] = useState<"save" | "submit" | "reload" | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const requestInFlight = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const stepTitleRef = useRef<HTMLHeadingElement>(null);
  const statusTitleRef = useRef<HTMLHeadingElement>(null);
  const locked = application?.status === "submitted" || application?.status === "approved";
  const dirty = !locked && fieldOrder.some(key => fields[key] !== savedFields[key]);
  const stepHasErrors = [firstStepFields, secondStepFields, []].map(group => group.some(key => errors[key]));

  useEffect(() => {
    if (!dirty) return;
    function warnOnLeave(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnOnLeave);
    return () => window.removeEventListener("beforeunload", warnOnLeave);
  }, [dirty]);

  function changeField(key: FieldName, value: string) {
    setFields(current => ({ ...current, [key]: value }));
    setErrors(current => ({ ...current, [key]: undefined }));
    setNotice("");
  }

  function inputProps(key: FieldName, hasHint = false) {
    return {
      id: `seller-${key}`, name: key, value: fields[key],
      onChange: (event: { target: { value: string } }) => changeField(key, event.target.value),
      "aria-invalid": Boolean(errors[key]),
      "aria-describedby": [hasHint && `seller-${key}-hint`, errors[key] && `seller-${key}-error`].filter(Boolean).join(" ") || undefined,
    };
  }

  function goToStep(next: number) {
    setStep(next);
    requestAnimationFrame(() => stepTitleRef.current?.focus());
  }

  function showFailure(message: string, fieldErrors: FieldErrors = {}) {
    setError(message);
    setErrors(fieldErrors);
    const firstField = fieldOrder.find(key => fieldErrors[key]);
    if (firstField) setStep(firstStepFields.includes(firstField) ? 0 : 1);
    requestAnimationFrame(() => {
      if (firstField) document.getElementById(`seller-${firstField}`)?.focus();
      else errorRef.current?.focus();
    });
  }

  function receiveApplication(next: SellerApplicationDTO | null) {
    const nextFields = next?.fields ?? { ...emptySellerFields, contactName: name.slice(0, 80) };
    setApplication(next);
    setFields(nextFields);
    setSavedFields(nextFields);
    setErrors({});
    setConflict(false);
  }

  async function save(action: "save" | "submit") {
    if (requestInFlight.current || locked || conflict) return;
    setError("");
    setNotice("");
    setSessionExpired(false);
    if (action === "submit") {
      const result = submittedFieldsSchema.safeParse(fields);
      if (!result.success) {
        const fieldErrors: FieldErrors = {};
        for (const issue of result.error.issues) {
          const key = issue.path[0] as FieldName;
          if (key in fields && !fieldErrors[key]) fieldErrors[key] = issue.message;
        }
        showFailure("Check the highlighted details before submitting your application.", fieldErrors);
        return;
      }
    }
    requestInFlight.current = true;
    setPending(action);
    try {
      const response = await fetch("/api/seller-application", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, version: application?.version ?? 0, fields }),
      });
      const result: ApplicationResponse | null = await response.json().catch(() => null);
      if (!response.ok || !result?.application) {
        if (response.status === 409) {
          setConflict(true);
          showFailure("Your application changed in another tab or during review. Your edits are still here. Reload the latest version before saving again.");
        } else if (response.status === 401) {
          setSessionExpired(true);
          showFailure("Your session has ended. Sign in again to save your application.");
        } else {
          showFailure(result?.error || "We couldn’t save your application. Please try again.", result?.fieldErrors);
        }
        return;
      }
      receiveApplication(result.application);
      setNotice(action === "submit" ? "Application submitted for review." : "Draft saved.");
      // Submitting replaces the long form with the shorter status view; move focus
      // (and the viewport) to its heading so the outcome is not left off-screen.
      if (action === "submit") requestAnimationFrame(() => {
        statusTitleRef.current?.focus({ preventScroll: true });
        window.scrollTo({ top: 0 });
      });
    } catch {
      showFailure("We couldn’t connect. Your edits are still here; please try again.");
    } finally {
      requestInFlight.current = false;
      setPending(null);
    }
  }

  async function reloadApplication() {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setPending("reload");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/seller-application", { cache: "no-store" });
      const result: ApplicationResponse | null = await response.json().catch(() => null);
      if (!response.ok || !result || !("application" in result)) {
        setSessionExpired(response.status === 401);
        showFailure(response.status === 401 ? "Your session has ended. Sign in again to check your application." : result?.error || "We couldn’t reload your application. Please try again.");
        return;
      }
      receiveApplication(result.application ?? null);
      setSessionExpired(false);
      setNotice("Latest application loaded.");
    } catch {
      showFailure("We couldn’t connect. Your current details are still here; please try again.");
    } finally {
      requestInFlight.current = false;
      setPending(null);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step < 2) goToStep(step + 1);
    else void save("submit");
  }

  return <main id="main" className="seller-page" data-ui>
    <Link className="seller-back" href="/account">← My account</Link>
    <header className="seller-page-heading">
      <div><h1>Seller application</h1><p>{locked ? "Your store details and the latest review status." : "Introduce your store to Cartiva. Save a draft and return whenever you’re ready."}</p></div>
      <span className="seller-status" data-status={application?.status ?? "draft"}>{statusLabels[application?.status ?? "draft"]}</span>
    </header>
    {application?.status === "changes_requested" && <section className="seller-feedback" aria-labelledby="seller-feedback-title">
      <h2 id="seller-feedback-title">A few details need your attention</h2>
      <p>{application.feedback}</p>
      <span>Saved updates remain visible to the review team. Submit again when your changes are ready for review.</span>
    </section>}
    {error && <div className="seller-error" role="alert" ref={errorRef} tabIndex={-1}>
      <p>{error}</p>
      {sessionExpired && <Link href="/sign-in?returnTo=%2Fbecome-vendor%2Fapply">Sign in again</Link>}
    </div>}
    {conflict && <div className="seller-conflict">
      <p>Reloading will replace the edits on this page with the latest saved application.</p>
      <button type="button" className="seller-secondary" disabled={Boolean(pending)} onClick={() => void reloadApplication()}>{pending === "reload" ? "Reloading…" : "Replace my edits with the latest version"}</button>
    </div>}
    <p className="seller-live-notice" role="status" aria-live="polite">{notice}</p>
    {locked && application ? <div className="seller-application-grid">
      <aside className="seller-status-summary">
        <h2 ref={statusTitleRef} tabIndex={-1}>{application.status === "approved" ? "Your store is approved" : "Your application is with us"}</h2>
        <p>{application.status === "approved" ? "Your local seller workspace is ready. Live selling and payouts are not available yet." : "Your submitted details are saved. If the reviewer needs changes, you can update and resubmit them here."}</p>
        {application.submittedAt && <p className="seller-hint">Submitted {savedDate(application.submittedAt)}</p>}
        {application.reviewedAt && <p className="seller-hint">Reviewed {savedDate(application.reviewedAt)}</p>}
        {application.status === "approved" ? <Link className="seller-primary" href="/vendor">Open seller workspace</Link> : <button className="seller-secondary" type="button" disabled={Boolean(pending)} onClick={() => void reloadApplication()}>{pending === "reload" ? "Checking…" : "Check review status"}</button>}
      </aside>
      <section className="seller-form-panel" aria-labelledby="seller-saved-title">
        <h2 id="seller-saved-title">{application.fields.storeName}</h2>
        {application.status === "approved" && application.feedback && <div className="seller-review-note"><h3>Reviewer’s note</h3><p>{application.feedback}</p></div>}
        <ApplicationDetails fields={application.fields} email={email} />
      </section>
    </div> : <div className="seller-application-grid">
      <nav className="seller-step-navigation" aria-label="Application steps">
        <ol>{steps.map((label, index) => <li key={label}><button type="button" aria-current={step === index ? "step" : undefined} data-invalid={stepHasErrors[index] || undefined} disabled={Boolean(pending)} onClick={() => goToStep(index)}><span aria-hidden="true">{index + 1}</span>{label}{stepHasErrors[index] && <em className="seller-step-alert">Needs attention</em>}</button></li>)}</ol>
        <p>Move between steps freely. Only Save draft or Submit application saves your details.</p>
      </nav>
      <form className="seller-form-panel" method="post" onSubmit={submit} noValidate aria-busy={Boolean(pending)}>
        <h2 ref={stepTitleRef} tabIndex={-1}>{steps[step]}</h2>
        <p className="seller-section-intro">{step === 0 ? "What will people find in your store? All details are required except the website." : step === 1 ? "Tell us where your store is based and who we should contact." : "Check your details before sending them for review. You can still go back and make changes."}</p>
        <fieldset disabled={Boolean(pending)}>
          <legend className="seller-sr-only">{steps[step]} details</legend>
          {step === 0 && <div className="seller-fields">
            <Field name="storeName" label="Store name" error={errors.storeName}><input {...inputProps("storeName")} autoComplete="organization" maxLength={80} required /></Field>
            <Field name="category" label="Primary category" error={errors.category}><select {...inputProps("category")} required><option value="">Choose a category</option>{sellerCategories.map(category => <option key={category}>{category}</option>)}</select></Field>
            <Field name="description" label="About your store" hint="Describe your products and what makes your store yours. Use 30–2,000 characters." error={errors.description}><textarea {...inputProps("description", true)} rows={6} maxLength={2000} required /></Field>
            <Field name="website" label="Website (optional)" hint="Use a full address beginning with https://, or leave this empty." error={errors.website}><input {...inputProps("website", true)} type="url" autoComplete="url" autoCapitalize="none" spellCheck={false} maxLength={300} /></Field>
          </div>}
          {step === 1 && <div className="seller-fields">
            <Field name="contactName" label="Contact name" error={errors.contactName}><input {...inputProps("contactName")} autoComplete="name" maxLength={80} required /></Field>
            <div className="seller-field"><label htmlFor="seller-email">Account email</label><input id="seller-email" type="email" value={email} readOnly autoComplete="email" aria-describedby="seller-email-hint" /><span id="seller-email-hint" className="seller-hint">Connected to your signed-in Cartiva account.</span></div>
            <div className="seller-field-pair">
              <Field name="city" label="City" error={errors.city}><input {...inputProps("city")} autoComplete="address-level2" maxLength={80} required /></Field>
              <Field name="state" label="State" error={errors.state}><select {...inputProps("state")} autoComplete="address-level1" required><option value="">Choose a state</option>{usStates.map(state => <option key={state}>{state}</option>)}</select></Field>
            </div>
            <div className="seller-country"><span>Country</span><p>United States</p></div>
          </div>}
          {step === 2 && <ApplicationDetails fields={fields} email={email} />}
          <div className="seller-form-actions">
            <div>{step > 0 && <button type="button" className="seller-secondary" onClick={() => goToStep(step - 1)}>Back</button>}<button type="button" className="seller-secondary" disabled={conflict || (Boolean(application) && !dirty)} onClick={() => void save("save")}>{pending === "save" ? "Saving…" : "Save draft"}</button></div>
            <button type="submit" className="seller-primary" disabled={!hydrated || (step === 2 && conflict)}>{pending === "submit" ? "Submitting…" : step < 2 ? "Continue" : application?.status === "changes_requested" ? "Resubmit application" : "Submit application"}</button>
          </div>
        </fieldset>
        <p className="seller-save-state">{dirty ? "You have unsaved changes." : application ? `Last saved ${savedDate(application.updatedAt)}` : "Your draft has not been saved yet."}</p>
      </form>
    </div>}
    <p className="seller-preview-note">Local preview · Your application is saved on this computer for review. Approval opens a local seller workspace; live selling and payouts are not available yet.</p>
  </main>;
}
