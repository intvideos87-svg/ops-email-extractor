"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import MsgReader from "msgreader";
import MsgReaderConst from "msgreader/lib/const";

type ShipmentBasics = {
  awb: string | null;
  hawb: string | null;
  origin: string | null;
  destination: string | null;
  pieces: string | null;
  weight: string | null;
  commodity: string | null;
};

type DeliveryMethod = {
  type: string | null;
  date: string | null;
  time: string | null;
};

type FlightDetails = {
  flight_number: string | null;
  flight_date: string | null;
  cutoff: string | null;
};

type CriticalFlags = {
  batteries_lithium: FlagField;
  dg_dgr: FlagField;
  msds_dgd: FlagField;
  fumigation_ispm15: FlagField;
  perishable: FlagField;
  temperature_control: FlagField;
  non_stackable: FlagField;
  pivot_weight: FlagField;
};

type FlagField = {
  status: "Mentioned" | "Not mentioned";
  evidence: string | null;
};

type PermitDeclaration = {
  mentioned: boolean;
  responsibility: string | null;
};

type AiExtractionResult = {
  shipment_basics: ShipmentBasics;
  delivery_method: DeliveryMethod;
  flight_details: FlightDetails;
  critical_flags: CriticalFlags;
  permit_declaration: PermitDeclaration;
  export_ops_notes: string[];
};

const sampleEmail = `Subject: SIN export request
From: customer.service@example.com
Date: 04 Jul 2026, 09:18

Hi Ops,

Please arrange collection for the below shipment.

Origin: SIN
Destination: FRA
AWB: 618-12345675
HAWB: HSG456789
Pieces: 4 wooden crates
Gross weight: 860 kg
Commodity: machinery spare parts

Collection date: 05 Jul 2026
Collection time: 10:30
Cut-off time: 16:00
Flight date: 05 Jul 2026
Flight: SQ 0510

Fumigation cert will follow.
Battery packed with equipment. MSDS attached.
Cargo is non-stackable.
Permit under shipper account.
Export ops pls take note: check fumigation cert before lodge-in.

Regards,
Customer Service`;

const emptyValue = "Not found";

function cleanValue(value: string) {
  return value
    .replace(/^[:\-\s]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function decodeQuotedPrintable(value: string) {
  return value
    .replace(/=\r?\n/g, "")
    .replace(/=([A-Fa-f0-9]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function parseEml(text: string) {
  const normalized = text.replace(/\r\n/g, "\n");
  const headerEnd = normalized.indexOf("\n\n");
  const bodyText = headerEnd >= 0 ? normalized.slice(headerEnd + 2) : normalized;
  return decodeQuotedPrintable(bodyText).trim();
}

function hasUnreadableContent(value: string) {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/.test(value);
}

function decodeHtmlEntities(value: string) {
  if (typeof document === "undefined") return value;
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function htmlToVisibleText(html: string) {
  if (hasUnreadableContent(html)) {
    throw new Error("Unreadable MSG HTML content");
  }

  const withoutHiddenBlocks = html
    .replace(/<head[\s\S]*?<\/head>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<meta[\s\S]*?>/gi, "\n")
    .replace(/<xml[\s\S]*?<\/xml>/gi, "\n");

  return decodeHtmlEntities(
    withoutHiddenBlocks
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<[^>]+>/g, " ")
  );
}

function normalizeVisibleMsgBody(value: string | undefined) {
  if (!value) return "";
  if (hasUnreadableContent(value)) {
    throw new Error("Unreadable MSG body content");
  }

  const normalized = value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00A0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (normalized.replace(/\s/g, "").length < 10) {
    throw new Error("MSG body is too short to trust");
  }

  return normalized;
}

function parseMsgFile(buffer: ArrayBuffer) {
  MsgReaderConst.MSG.FIELD.NAME_MAPPING["1013"] = "htmlBody";
  const reader = new MsgReader(buffer);
  const data = reader.getFileData() as {
    error?: string;
    body?: string;
    htmlBody?: string;
  };

  if (data.error) {
    throw new Error(data.error);
  }

  return normalizeVisibleMsgBody(data.htmlBody ? htmlToVisibleText(data.htmlBody) : data.body);
}

function failMsgParsing() {
  return "Outlook MSG drag/drop is not clean enough. Please open the email, press Ctrl+A, copy, and paste into the app.";
}

function isHeaderLine(line: string) {
  return /^(from|sent|to|cc|bcc|subject|date):\s*/i.test(line);
}

function isReplyHeader(line: string) {
  return /^-+\s*original message\s*-+$/i.test(line) || /^on .+wrote:$/i.test(line) || /^from:\s*/i.test(line);
}

function isFooterStart(line: string) {
  return /^(best regards|kind regards|regards|thanks|thank you|disclaimer|this email|networks:)\b/i.test(line);
}

function isFooterNoise(line: string) {
  return (
    /^sent from my /i.test(line) ||
    /^(linkedin|facebook|instagram|youtube|twitter|x\.com)\b/i.test(line) ||
    /^please consider the environment/i.test(line) ||
    /^this message and any attachments/i.test(line) ||
    /^confidentiality notice/i.test(line)
  );
}

function cleanEmailForAnalysis(input: string) {
  const cleanedLines: string[] = [];
  let skippingFooter = false;

  for (const rawLine of input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    if (isReplyHeader(line)) {
      skippingFooter = false;
      continue;
    }

    if (skippingFooter) continue;
    if (isHeaderLine(line) || isFooterNoise(line)) continue;

    if (isFooterStart(line)) {
      skippingFooter = true;
      continue;
    }

    cleanedLines.push(line);
  }

  return cleanedLines.join("\n");
}

function displayValue(value: string | null | boolean) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value && cleanValue(value) ? value : emptyValue;
}

function buildSummary(result: AiExtractionResult, cleanedEmail: string) {
  return [
    "Ops Email Extractor Summary",
    "",
    "Shipment Basics",
    `- AWB: ${displayValue(result.shipment_basics.awb)}`,
    `- HAWB: ${displayValue(result.shipment_basics.hawb)}`,
    `- Origin: ${displayValue(result.shipment_basics.origin)}`,
    `- Destination: ${displayValue(result.shipment_basics.destination)}`,
    `- Pieces: ${displayValue(result.shipment_basics.pieces)}`,
    `- Weight: ${displayValue(result.shipment_basics.weight)}`,
    `- Commodity: ${displayValue(result.shipment_basics.commodity)}`,
    "",
    "Delivery Method",
    `- Type: ${displayValue(result.delivery_method.type)}`,
    `- Date: ${displayValue(result.delivery_method.date)}`,
    `- Time: ${displayValue(result.delivery_method.time)}`,
    "",
    "Flight Details",
    `- Flight number: ${displayValue(result.flight_details.flight_number)}`,
    `- Flight date: ${displayValue(result.flight_details.flight_date)}`,
    `- Cut-off: ${displayValue(result.flight_details.cutoff)}`,
    "",
    "Critical Flags",
    ...Object.entries(result.critical_flags).map(([key, value]) => `- ${flagLabel(key)}: ${value.status}${value.evidence ? ` | ${value.evidence}` : ""}`),
    "",
    "Permit Declaration",
    `- Mentioned: ${displayValue(result.permit_declaration.mentioned)}`,
    `- Responsibility: ${displayValue(result.permit_declaration.responsibility)}`,
    "",
    "Export Ops Notes",
    ...(result.export_ops_notes.length ? result.export_ops_notes.map((note) => `- ${note}`) : ["- None"]),
    "",
    "Cleaned Email Preview",
    cleanedEmail || "No analyzable text after cleaning"
  ].join("\n");
}

export default function Home() {
  const [emailText, setEmailText] = useState("");
  const [fileName, setFileName] = useState("");
  const [message, setMessage] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [result, setResult] = useState<AiExtractionResult | null>(null);
  const [cleanedEmail, setCleanedEmail] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const summaryText = useMemo(() => (result ? buildSummary(result, cleanedEmail) : ""), [result, cleanedEmail]);

  async function handleFile(file: File) {
    setMessage("");
    setFileName(file.name);
    setResult(null);
    setCleanedEmail("");
    const extension = file.name.split(".").pop()?.toLowerCase();

    try {
      if (extension === "txt") {
        setEmailText(await file.text());
      } else if (extension === "eml") {
        setEmailText(parseEml(await file.text()));
      } else if (extension === "msg") {
        setEmailText("");
        setEmailText(parseMsgFile(await file.arrayBuffer()));
      } else {
        setMessage("Unsupported file format. Please use .txt, .eml, or .msg.");
      }
    } catch {
      if (extension === "msg") {
        setEmailText("");
        setMessage(failMsgParsing());
      } else {
        setMessage("The file could not be read. Please paste the email thread instead.");
      }
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  async function runExtraction() {
    if (!emailText.trim()) {
      setMessage("Paste, upload, or drag an email thread before extracting.");
      return;
    }

    const cleaned = cleanEmailForAnalysis(emailText);
    if (!cleaned) {
      setMessage("No analyzable email content remains after cleaning.");
      return;
    }

    setIsExtracting(true);
    setMessage("Extracting ops details with AI.");
    setResult(null);
    setCleanedEmail(cleaned);

    try {
      const response = await fetch("/api/deep-extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ cleanedEmail: cleaned })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "AI extraction failed.");
      }

      setResult(payload.result as AiExtractionResult);
      setMessage("Extraction complete.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI extraction failed.");
    } finally {
      setIsExtracting(false);
    }
  }

  async function copySummary() {
    if (!summaryText) return;
    await navigator.clipboard.writeText(summaryText);
    setMessage("Summary copied.");
  }

  function exportText() {
    if (!summaryText) return;
    const blob = new Blob([summaryText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ops-email-extractor-summary.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  function clearAll() {
    setEmailText("");
    setFileName("");
    setMessage("");
    setResult(null);
    setCleanedEmail("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/union-airfreight-logo.svg" alt="Union Airfreight logo" />
          <div>
            <p>Built By Muhd Ridwan For</p>
            <strong>Union Airfreight (Singapore) Pte Ltd</strong>
          </div>
        </div>
        <div className="titleBlock">
          <h1>Ops Email Extractor</h1>
          <span>AI export ops instruction board</span>
        </div>
      </header>

      <section className="workspace">
        <aside className="panel inputPanel">
          <div className="panelHeader">
            <div>
              <span className="eyebrow">Input</span>
              <h2>Email thread</h2>
            </div>
            {fileName && <span className="fileBadge">{fileName}</span>}
          </div>

          <div
            className={`dropZone ${isDragging ? "dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
          >
            <input ref={fileInputRef} type="file" accept=".txt,.eml,.msg" onChange={onFileChange} />
            <button className="secondaryButton" type="button" onClick={() => fileInputRef.current?.click()}>
              Upload .txt / .eml / .msg
            </button>
            <span>or drag and drop file here</span>
          </div>

          <textarea
            value={emailText}
            onChange={(event) => setEmailText(event.target.value)}
            placeholder="Paste the full customer service email thread here..."
            spellCheck={false}
          />

          {message && <div className="notice">{message}</div>}

          <div className="actions">
            <button type="button" onClick={runExtraction} disabled={isExtracting}>
              {isExtracting ? "Extracting..." : "Extract Ops Details"}
            </button>
            <button className="secondaryButton" type="button" onClick={() => setEmailText(sampleEmail)}>
              Sample Email
            </button>
            <button className="ghostButton" type="button" onClick={clearAll}>
              Clear / Reset
            </button>
          </div>
        </aside>

        <section className="panel outputPanel">
          <div className="panelHeader">
            <div>
              <span className="eyebrow">Output</span>
              <h2>Export ops action board</h2>
            </div>
            <div className="outputActions">
              <button className="secondaryButton" type="button" onClick={copySummary} disabled={!result}>
                Copy Summary
              </button>
              <button className="secondaryButton" type="button" onClick={exportText} disabled={!result}>
                Export as Text
              </button>
            </div>
          </div>

          {!result ? (
            <div className="emptyState">
              <span>Ready</span>
              <p>Paste, upload, or drag an email thread, then extract. AI will return null for details that are not explicitly mentioned.</p>
            </div>
          ) : (
            <div className="results">
              <ObjectCard title="Shipment Basics" rows={result.shipment_basics} />
              <ObjectCard title="Delivery Method" rows={result.delivery_method} />
              <ObjectCard title="Flight Details" rows={result.flight_details} />
              <FlagsCard flags={result.critical_flags} />

              <article className="card">
                <div className="cardTitle">
                  <h3>Permit Declaration</h3>
                </div>
                <div className="dataTable">
                  <div className="dataRow">
                    <span>Mentioned</span>
                    <strong>{displayValue(result.permit_declaration.mentioned)}</strong>
                    <small>AI</small>
                  </div>
                  <div className="dataRow">
                    <span>Responsibility</span>
                    <strong className={!result.permit_declaration.responsibility ? "mutedValue" : ""}>{displayValue(result.permit_declaration.responsibility)}</strong>
                    <small>AI</small>
                  </div>
                </div>
              </article>

              <article className="card">
                <div className="cardTitle">
                  <h3>Export Ops Notes</h3>
                  <span className="count">{result.export_ops_notes.length} found</span>
                </div>
                {result.export_ops_notes.length ? (
                  <ul className="checklist">
                    {result.export_ops_notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="quietText">No direct export ops notes found.</p>
                )}
              </article>

              <details className="card wide cleanedPreview">
                <summary>Cleaned Email Preview</summary>
                <pre>{cleanedEmail || "No analyzable text after cleaning."}</pre>
              </details>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function ObjectCard({ title, rows }: { title: string; rows: Record<string, string | null> }) {
  const entries = Object.entries(rows);
  const found = entries.filter(([, value]) => value).length;

  return (
    <article className="card">
      <div className="cardTitle">
        <h3>{title}</h3>
        <span className="count">{found} found</span>
      </div>
      <div className="dataTable">
        {entries.map(([key, value]) => (
          <div className="dataRow" key={key}>
            <span>{key.replaceAll("_", " ")}</span>
            <strong className={!value ? "mutedValue" : ""}>{displayValue(value)}</strong>
            <small>AI</small>
          </div>
        ))}
      </div>
    </article>
  );
}

function FlagsCard({ flags }: { flags: CriticalFlags }) {
  const entries = Object.entries(flags);
  const active = entries.filter(([, value]) => value.status === "Mentioned").length;

  return (
    <article className="card wide">
      <div className="cardTitle">
        <h3>Critical Cargo Flags</h3>
        <span className="count">{active} active</span>
      </div>
      <div className="flagGrid">
        {entries.map(([key, value]) => (
          <div className="flagItem" key={key}>
            <div>
              <strong>{flagLabel(key)}</strong>
              <p>{value.status === "Mentioned" ? value.evidence || "Mentioned" : "Not mentioned"}</p>
            </div>
            <span className={`badge ${value.status === "Mentioned" ? "critical" : "clear"}`}>{value.status}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

function flagLabel(key: string) {
  const labels: Record<string, string> = {
    batteries_lithium: "Batteries / Lithium",
    dg_dgr: "DG / DGR",
    msds_dgd: "MSDS / DGD",
    fumigation_ispm15: "Fumigation / ISPM15",
    perishable: "Perishable",
    temperature_control: "Temperature control",
    non_stackable: "Non-stackable",
    pivot_weight: "Pivot weight"
  };

  return labels[key] || key.replaceAll("_", " ");
}
