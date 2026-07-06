"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";

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
  evidence: string | null;
  date_basis: string | null;
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
  magnetized: FlagField;
};

type FlagField = {
  status: "Mentioned" | "Not mentioned";
  interpretation: string | null;
  evidence: string | null;
  keyword: string | null;
  email_context: string | null;
  line_number: number | null;
};

type PermitDeclaration = {
  mentioned: boolean;
  responsibility: string | null;
  evidence: string | null;
};

type AiExtractionResult = {
  shipment_basics: ShipmentBasics;
  delivery_method: DeliveryMethod;
  flight_details: FlightDetails;
  critical_flags: CriticalFlags;
  permit_declaration: PermitDeclaration;
  export_ops_notes: string[];
};

const emptyValue = "Not found";
const awbPattern = /\b\d{3}-\d{8}\b/;
const hawbPattern = /\b(?:HAWB\s*#?|HAWB:|House AWB|HBL)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,})\b/i;

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
  const headerText = headerEnd >= 0 ? normalized.slice(0, headerEnd) : "";
  const bodyText = headerEnd >= 0 ? normalized.slice(headerEnd + 2) : normalized;
  const headers = ["Subject", "From", "To", "Date"]
    .map((header) => {
      const match = headerText.match(new RegExp(`^${header}:\\s*(.+)$`, "im"));
      return match ? `${header}: ${cleanValue(match[1])}` : "";
    })
    .filter(Boolean);

  return [...headers, "", decodeQuotedPrintable(bodyText)].join("\n").trim();
}

function unsupportedMsgMessage() {
  return "Outlook .msg is not supported. Please save/export as .eml or copy/paste the email thread.";
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

    const subject = line.match(/^subject:\s*(.+)$/i)?.[1];
    if (subject) {
      const awb = subject.match(awbPattern)?.[0];
      const hawb = subject.match(hawbPattern)?.[1];
      if (awb) cleanedLines.push(`Subject AWB: ${awb}`);
      if (hawb) cleanedLines.push(`Subject HAWB: ${hawb}`);
      continue;
    }

    if (isHeaderLine(line)) {
      const awb = line.match(awbPattern)?.[0];
      const hawb = line.match(hawbPattern)?.[1];
      if (awb) cleanedLines.push(`Header AWB: ${awb}`);
      if (hawb) cleanedLines.push(`Header HAWB: ${hawb}`);
      continue;
    }

    if (isHeaderLine(line) || isFooterNoise(line)) continue;

    if (isFooterStart(line)) {
      skippingFooter = true;
      continue;
    }

    cleanedLines.push(line);
  }

  return cleanedLines.join("\n");
}

function extractEmailSentDateBasis(input: string) {
  const lines = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(/^(sent|date):\s*(.+)$/i);
    if (match) {
      return cleanValue(match[2]);
    }
  }

  return null;
}

function displayValue(value: string | null | boolean) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value && cleanValue(value) ? value : emptyValue;
}

function fieldLabel(key: string) {
  const labels: Record<string, string> = {
    awb: "AWB",
    hawb: "HAWB",
    origin: "Origin",
    destination: "Destination",
    pieces: "Pieces",
    weight: "Weight",
    commodity: "Commodity",
    type: "Type",
    date: "Date",
    time: "Time",
    evidence: "Evidence",
    date_basis: "Date Basis",
    flight_number: "Flight Number",
    flight_date: "Flight Date",
    cutoff: "Cut-off"
  };

  return labels[key] || key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function extractSender(value: string | null) {
  if (!value) return null;
  const match = value.match(/(?:sender|from):\s*([^,\n;]+)/i);
  return match ? cleanValue(match[1]) : null;
}

function extractTimestamp(value: string | null) {
  if (!value) return null;
  const match = value.match(/(?:timestamp|sent|date):\s*([^,\n;]+)/i);
  return match ? cleanValue(match[1]) : null;
}

function buildFlagReasons(flag: FlagField) {
  const reasons: string[] = [];
  if (flag.keyword) reasons.push(`Found keyword: ${flag.keyword}`);
  if (flag.evidence?.match(/\bUN\d{4}\b/i)) reasons.push(`Found UN number: ${flag.evidence.match(/\bUN\d{4}\b/i)?.[0].toUpperCase()}`);
  if (flag.evidence?.match(/\bPI\s*\d{3}\b/i)) reasons.push(`Found packing instruction: ${flag.evidence.match(/\bPI\s*\d{3}\b/i)?.[0].replace(/\s+/g, "")}`);
  if (flag.status === "Mentioned" && flag.evidence) reasons.push("Positive cargo declaration context");
  if (flag.status === "Not mentioned" && flag.evidence) reasons.push("Mentioned only as restriction/check");
  return reasons.length ? reasons : [flag.status === "Mentioned" ? "AI classified this as an active cargo flag" : "No active cargo confirmation found"];
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
    `- Evidence: ${displayValue(result.delivery_method.evidence)}`,
    `- Date basis: ${displayValue(result.delivery_method.date_basis)}`,
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
  const [sentDateBasis, setSentDateBasis] = useState<string | null>(null);
  const [selectedFlag, setSelectedFlag] = useState<{ label: string; value: FlagField } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const summaryText = useMemo(() => (result ? buildSummary(result, cleanedEmail) : ""), [result, cleanedEmail]);

  async function handleFile(file: File) {
    setMessage("");
    setFileName(file.name);
    setResult(null);
    setCleanedEmail("");
    setSentDateBasis(null);
    setSelectedFlag(null);
    const extension = file.name.split(".").pop()?.toLowerCase();

    try {
      if (extension === "txt") {
        setEmailText(await file.text());
      } else if (extension === "eml") {
        setEmailText(parseEml(await file.text()));
      } else if (extension === "msg") {
        setEmailText("");
        setMessage(unsupportedMsgMessage());
      } else {
        setMessage("Unsupported file format. Please use .txt or .eml.");
      }
    } catch {
      if (extension === "msg") {
        setEmailText("");
        setMessage(unsupportedMsgMessage());
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
    setSentDateBasis(extractEmailSentDateBasis(emailText));

    try {
      const response = await fetch("/api/deep-extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ cleanedEmail: cleaned, emailSentDate: extractEmailSentDateBasis(emailText) })
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
    setSentDateBasis(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/uaf-logo.jpeg" alt="Union Airfreight logo" />
          <div>
            <p>Built By Muhd Ridwan For</p>
            <strong>Union Airfreight (Singapore) Pte Ltd</strong>
          </div>
        </div>
        <div className="titleBlock">
          <h1>Email Extractor</h1>
          <span>Powered by A.I</span>
        </div>
      </header>

      <section className="workspace">
        <aside className="panel inputPanel">
          <div className="panelHeader">
            <div>
              <span className="eyebrow">Input</span>
              <h2>Email Thread</h2>
            </div>
          </div>

          <p className="pasteInstruction">
            <strong>How to use:</strong> Open your Email thread, press Ctrl + A, then Ctrl + C, and paste it below.
          </p>

          <textarea
            value={emailText}
            onChange={(event) => setEmailText(event.target.value)}
            placeholder="Paste email thread here..."
            spellCheck={false}
          />

          {message && <div className="notice">{message}</div>}

          <div className="actions">
            <button type="button" onClick={runExtraction} disabled={isExtracting}>
              {isExtracting ? "Extracting..." : "Extract Ops Details"}
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
              <h2>Action Board</h2>
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
                  <div className="dataRow">
                    <span>Evidence</span>
                    <strong className={!result.permit_declaration.evidence ? "mutedValue" : ""}>{displayValue(result.permit_declaration.evidence)}</strong>
                    <small>AI</small>
                  </div>
                </div>
              </article>

              <FlagsCard flags={result.critical_flags} onSelect={setSelectedFlag} />

              <article className="card wide">
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
                <pre>{`${sentDateBasis ? `Email Sent Date Basis: ${sentDateBasis}\n\n` : ""}${cleanedEmail || "No analyzable text after cleaning."}`}</pre>
              </details>
            </div>
          )}
        </section>
      </section>

      {selectedFlag && (
        <div className="modalOverlay" role="dialog" aria-modal="true" aria-label={`${selectedFlag.label} evidence`}>
          <div className="modalCard">
            <div className="modalHeader">
              <div>
                <span className="eyebrow">Critical Flag Evidence</span>
                <h3>{selectedFlag.label}</h3>
              </div>
              <button className="ghostButton modalClose" type="button" onClick={() => setSelectedFlag(null)}>
                Close
              </button>
            </div>
            <div className="modalEvidence">
              <div>
                <span>Status</span>
                <strong>{selectedFlag.value.status === "Mentioned" ? "Mentioned" : selectedFlag.value.evidence ? "Not active" : "Not mentioned"}</strong>
              </div>
              <div className="modalSentence modalInterpretation">
                <span>AI Interpretation</span>
                <p>{selectedFlag.value.interpretation || (selectedFlag.value.status === "Mentioned" ? "Flag is active based on the cited cargo instruction." : "No active cargo confirmation found for this flag.")}</p>
              </div>
              <div>
                <span>Sender</span>
                <strong>{extractSender(selectedFlag.value.email_context) || extractSender(selectedFlag.value.evidence) || "Not available"}</strong>
              </div>
              <div>
                <span>Timestamp</span>
                <strong>{extractTimestamp(selectedFlag.value.email_context) || extractTimestamp(selectedFlag.value.evidence) || "Not available"}</strong>
              </div>
              <div className="modalSentence">
                <span>Matched Sentence</span>
                <p>{highlightKeyword(selectedFlag.value.evidence || "No evidence available.", selectedFlag.value.keyword)}</p>
              </div>
              <div className="modalSentence">
                <span>{selectedFlag.value.status === "Mentioned" ? "Why Flagged" : "Why NOT Flagged"}</span>
                <ul className="reasonList">
                  {buildFlagReasons(selectedFlag.value).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
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
            <span>{fieldLabel(key)}</span>
            <strong className={!value ? "mutedValue" : ""}>{displayValue(value)}</strong>
            <small>AI</small>
          </div>
        ))}
      </div>
    </article>
  );
}

function FlagsCard({ flags, onSelect }: { flags: CriticalFlags; onSelect: (flag: { label: string; value: FlagField }) => void }) {
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
          <button
            className={`flagItem flagButton ${value.evidence ? "isClickable" : ""}`}
            key={key}
            type="button"
            onClick={() => {
              if (value.evidence) onSelect({ label: flagLabel(key), value });
            }}
            disabled={!value.evidence}
          >
            <div>
              <strong>{flagLabel(key)}</strong>
              <p>{value.evidence ? "Click to verify evidence" : "Not mentioned"}</p>
            </div>
            <span className={`badge ${value.status === "Mentioned" ? "critical" : "clear"}`}>{value.status}</span>
          </button>
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
    pivot_weight: "Pivot weight",
    magnetized: "Magnetized"
  };

  return labels[key] || key.replaceAll("_", " ");
}

function highlightKeyword(sentence: string, keyword: string | null) {
  if (!keyword) return sentence;
  const lowerSentence = sentence.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  const index = lowerSentence.indexOf(lowerKeyword);

  if (index < 0) return sentence;

  return (
    <>
      {sentence.slice(0, index)}
      <mark>{sentence.slice(index, index + keyword.length)}</mark>
      {sentence.slice(index + keyword.length)}
    </>
  );
}
