"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import MsgReader from "msgreader";

type Evidence = {
  line: number;
  text: string;
};

type FieldValue = {
  label: string;
  value: string;
  evidence?: Evidence;
};

type FlagResult = {
  label: string;
  status: "Mentioned" | "Not mentioned";
  phrase: string;
  evidence?: Evidence;
  severity: "critical" | "attention" | "clear";
};

type ExtractionResult = {
  snapshot: FieldValue[];
  timeline: FieldValue[];
  flags: FlagResult[];
  missing: string[];
  checklist: string[];
  evidence: Evidence[];
  cleanedEmail: string;
};

const notMentioned = "Not mentioned";

const snapshotFields = [
  {
    label: "Shipper",
    patterns: [/^\s*(shipper|shipper name)\s*[:\-]\s*(.+)$/i]
  },
  {
    label: "Consignee",
    patterns: [/^\s*(consignee|receiver|consignee name)\s*[:\-]\s*(.+)$/i]
  },
  {
    label: "Origin",
    patterns: [/^\s*(origin|origin airport)\s*[:\-]\s*(.+)$/i, /\b([A-Z]{3})\s*(?:-|to)\s*([A-Z]{3})\b/i]
  },
  {
    label: "Destination",
    patterns: [/^\s*(destination|dest|destination airport)\s*[:\-]\s*(.+)$/i, /\b([A-Z]{3})\s*(?:-|to)\s*([A-Z]{3})\b/i]
  },
  {
    label: "AWB number",
    patterns: [/\b(?:mawb|awb|air waybill)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([0-9]{3}-[0-9]{8})\b/i]
  },
  {
    label: "HAWB number",
    patterns: [/\b(?:hawb|house awb)\s*(?:no\.?|number|#)?\s*[:#\-]?\s*([A-Z0-9-]{4,})\b/i, /\b(SGMTCT[0-9A-Z]{4,})\b/i]
  },
  {
    label: "Pieces",
    patterns: [/\b(?:pieces|piece|pcs|pkgs|packages)\s*[:\-]?\s*([0-9,]+\s*(?:pcs|pieces|pkgs|packages|ctns|cartons)?)\b/i]
  },
  {
    label: "Gross weight",
    patterns: [/\b(?:gross weight|g\/w|gw)\s*[:\-]?\s*([0-9,.]+\s*(?:kgs?|kg|lbs?|lb))\b/i]
  },
  {
    label: "Chargeable weight",
    patterns: [/\b(?:chargeable weight|c\/w|cw)\s*[:\-]?\s*([0-9,.]+\s*(?:kgs?|kg|lbs?|lb))\b/i]
  },
  {
    label: "Dimensions",
    patterns: [/\b(?:dimensions?|dims?|dimension)\s*[:\-]?\s*(.+)$/i, /\b([0-9,.]+\s*[xX]\s*[0-9,.]+\s*[xX]\s*[0-9,.]+\s*(?:cm|mm|m|in|inch|inches)?)\b/i]
  },
  {
    label: "Commodity",
    patterns: [/^\s*(commodity|goods description|description of goods)\s*[:\-]\s*(.+)$/i]
  },
  {
    label: "Invoice number",
    patterns: [/\b(?:invoice|commercial invoice|inv)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9-\/]+)\b/i]
  },
  {
    label: "Packing list number",
    patterns: [/\b(?:packing list|packing list no\.?|pl no\.?|p\/l)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9-\/]+)\b/i]
  }
];

const timelineFields = [
  {
    label: "Cargo collection date",
    patterns: [/\b(?:collection date|pickup date|pick up date|collect on|cargo ready date|truck date|driver date|warehouse date|delivery date)\s*[:\-]?\s*(.+)$/i]
  },
  {
    label: "Cargo collection time",
    patterns: [/\b(?:collection time|pickup time|pick up time|collect at|cargo ready time|truck time|driver time|warehouse time|delivery time)\s*[:\-]?\s*(.+)$/i]
  },
  {
    label: "Collection address",
    patterns: [/^\s*(collection address|pickup address|pick up address|collect from)\s*[:\-]\s*(.+)$/i]
  },
  {
    label: "Collection contact person",
    patterns: [/^\s*(contact person|pickup contact|collection contact|attn)\s*[:\-]\s*(.+)$/i]
  },
  {
    label: "Collection contact number",
    patterns: [/\b(?:contact number|contact no\.?|mobile|tel|phone|hp)\s*[:\-]?\s*([+()0-9\s-]{6,})\b/i]
  },
  {
    label: "Warehouse receiving time",
    patterns: [/\b(?:warehouse receiving time|receiving time|warehouse receive by|warehouse opens?)\s*[:\-]?\s*(.+)$/i]
  },
  {
    label: "Cut-off time",
    patterns: [/\b(?:cut[-\s]?off|cut off time|closing time)\s*[:\-]?\s*(.+)$/i]
  },
  {
    label: "Flight date",
    patterns: [/\b(?:flight date|flt date)\s*[:\-]?\s*(.+)$/i]
  },
  {
    label: "Flight number",
    patterns: [/\b(?:flight|flt|flight no\.?|flight number)\s*[:\-]?\s*([A-Z0-9]{2,3}\s?[0-9]{2,4}[A-Z]?)\b/i]
  },
  {
    label: "ETD",
    patterns: [/\bETD\s*[:\-]?\s*(.+)$/i]
  },
  {
    label: "ETA",
    patterns: [/\bETA\s*[:\-]?\s*(.+)$/i]
  },
  {
    label: "Required delivery date",
    patterns: [/\b(?:required delivery date|delivery date|deliver by)\s*[:\-]?\s*(.+)$/i]
  },
  {
    label: "Required delivery time",
    patterns: [/\b(?:required delivery time|delivery time)\s*[:\-]?\s*(.+)$/i]
  }
];

const flags = [
  { label: "Fumigation", terms: ["fumigation", "fumigated", "fumigation cert"] },
  { label: "ISPM15", terms: ["ISPM15", "ISPM 15"] },
  { label: "Wooden packaging", terms: ["wooden packaging", "wooden crate", "wooden pallet", "wood packing"] },
  { label: "Battery", terms: ["battery", "batteries"] },
  { label: "Lithium battery", terms: ["lithium", "lithium ion", "lithium metal", "UN3480", "UN3481"] },
  { label: "Dangerous goods / DG / DGR", terms: ["dangerous goods", "dgr", "dg", "un number"] },
  { label: "MSDS", terms: ["msds"] },
  { label: "DGD", terms: ["dgd"] },
  { label: "Perishable", terms: ["perishable", "fresh", "food", "meat", "seafood", "vegetable"] },
  { label: "Temperature control", terms: ["temp", "temperature", "chilled", "frozen", "cool", "ambient"] },
  { label: "Frozen / chilled / ambient", terms: ["frozen", "chilled", "ambient"] },
  { label: "Equipment cargo", terms: ["equipment", "machine", "machinery"] },
  { label: "Oversized cargo", terms: ["oversized", "OOG", "over gauge"] },
  { label: "Heavy cargo", terms: ["heavy cargo", "heavy shipment", "heavy piece"] },
  { label: "Stackable", terms: ["stackable"] },
  { label: "Non-stackable", terms: ["non-stackable", "non stackable", "not stackable"] },
  { label: "Fragile", terms: ["fragile"] },
  { label: "Urgent shipment", terms: ["urgent", "asap", "immediate"] },
  { label: "Same-day uplift", terms: ["same day", "today uplift", "same-day uplift"] },
  { label: "Permit", terms: ["permit"] },
  { label: "Export permit", terms: ["export permit"] },
  { label: "Import permit", terms: ["import permit"] },
  { label: "COO", terms: ["coo", "certificate of origin"] },
  { label: "Insurance", terms: ["insurance", "insured"] },
  { label: "Pivot weight", terms: ["pivot weight"] },
  { label: "Special airline instruction", terms: ["special airline instruction", "airline instruction", "airline instructions"] }
];

const sampleEmail = `Subject: SIN export - urgent uplift request
From: customer.service@example.com
Date: 04 Jul 2026, 09:18

Hi Ops,

Please arrange collection for the below shipment.

Shipper: ABC Precision Pte Ltd
Consignee: Delta Tools GmbH
Origin: Singapore
Destination: FRA
AWB: 618-12345675
HAWB: HSG456789
Pieces: 4 wooden crates
Gross weight: 860 kg
Chargeable weight: 910 kg
Dimensions: 120 x 100 x 95 cm / 4 crates
Commodity: machinery spare parts
Invoice no: INV-77821
Packing list no: PL-77821

Collection date: 05 Jul 2026
Collection time: 10:30
Collection address: 10 Tuas Avenue 8, Singapore
Contact person: Mr Tan
Contact number: +65 6123 8899
Cut-off time: 16:00
Flight date: 05 Jul 2026
Flight: SQ326
ETD: 23:55
ETA: 06 Jul 2026 06:20

Fumigation cert will follow.
Battery packed with equipment. MSDS attached.
Cargo is non-stackable. Urgent same day uplift required.

Regards,
Customer Service`;

function cleanValue(value: string) {
  return value
    .replace(/^[:\-\s]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function parseHeaderValue(headers: string | undefined, headerName: string) {
  if (!headers) return "";
  const pattern = new RegExp(`^${headerName}:\\s*(.+(?:\\n[\\t ].+)*)`, "im");
  const match = headers.match(pattern);
  return match ? cleanValue(match[1].replace(/\n[\t ]+/g, " ")) : "";
}

function hasUnreadableContent(value: string) {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/.test(value);
}

function cleanMsgField(value: string | undefined) {
  if (!value) return "";
  if (hasUnreadableContent(value)) {
    throw new Error("Unreadable MSG content");
  }
  return cleanValue(value.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
}

function parseMsgFile(buffer: ArrayBuffer) {
  const reader = new MsgReader(buffer);
  const data = reader.getFileData() as {
    error?: string;
    subject?: string;
    senderName?: string;
    senderEmail?: string;
    headers?: string;
    body?: string;
  };

  if (data.error) {
    throw new Error(data.error);
  }

  const subject = cleanMsgField(data.subject);
  const senderName = cleanMsgField(data.senderName);
  const senderEmail = cleanMsgField(data.senderEmail);
  const headerSender = cleanMsgField(parseHeaderValue(data.headers, "From"));
  const sentDate = cleanMsgField(parseHeaderValue(data.headers, "Date"));
  const body = cleanMsgField(data.body);
  const sender = [senderName, senderEmail].filter(Boolean).join(" ").trim() || headerSender;

  if (!subject && !sender && !sentDate && !body) {
    throw new Error("No readable MSG fields found");
  }

  return [
    `Subject: ${subject || notMentioned}`,
    `Sender: ${sender || notMentioned}`,
    `Sent date: ${sentDate || notMentioned}`,
    "",
    "Plain text body:",
    body || notMentioned
  ].join("\n");
}

function failMsgParsing() {
  return "MSG parsing failed. Please paste the email thread or use .eml.";
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

function valueFromMatch(label: string, match: RegExpMatchArray) {
  if ((label === "Origin" || label === "Destination") && match[1] && match[2] && /^[A-Z]{3}$/.test(match[1]) && /^[A-Z]{3}$/.test(match[2])) {
    return label === "Origin" ? match[1] : match[2];
  }

  return match[2] || match[1] || "";
}

function hasCollectionContext(line: string) {
  return /\b(collection|pickup|pick up|collect|truck|driver|cargo ready|delivery|warehouse)\b/i.test(line);
}

function findField(lines: string[], label: string, patterns: RegExp[]): FieldValue {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if ((label === "Cargo collection date" || label === "Cargo collection time") && !hasCollectionContext(line)) {
      continue;
    }
    if ((label === "Cargo collection date" || label === "Cargo collection time") && /\brequired delivery\b/i.test(line)) {
      continue;
    }

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        const raw = valueFromMatch(label, match);
        const value = cleanValue(raw || "");
        if (value) {
          return {
            label,
            value,
            evidence: {
              line: index + 1,
              text: line
            }
          };
        }
      }
    }
  }

  return { label, value: notMentioned };
}

function findFlag(lines: string[], label: string, terms: string[]): FlagResult {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const term of terms) {
      const pattern = new RegExp(`\\b${escapeRegex(term).replace(/\\ /g, "\\s+")}\\b`, "i");
      const match = line.match(pattern);
      if (match) {
        return {
          label,
          status: "Mentioned",
          phrase: match[0],
          evidence: {
            line: index + 1,
            text: line
          },
          severity: ["Battery", "Lithium battery", "Dangerous goods / DG / DGR", "DGD", "MSDS", "Fumigation"].includes(label)
            ? "critical"
            : "attention"
        };
      }
    }
  }

  return {
    label,
    status: "Not mentioned",
    phrase: notMentioned,
    severity: "clear"
  };
}

function uniqueEvidence(items: Array<FieldValue | FlagResult>) {
  const seen = new Set<string>();
  const result: Evidence[] = [];

  for (const item of items) {
    if (!item.evidence) continue;
    const key = `${item.evidence.line}:${item.evidence.text}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item.evidence);
    }
  }

  return result.sort((a, b) => a.line - b.line);
}

function extractDetails(input: string): ExtractionResult {
  const cleanedEmail = cleanEmailForAnalysis(input);
  const lines = cleanedEmail
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const snapshot = snapshotFields.map((field) => findField(lines, field.label, field.patterns));
  const timeline = timelineFields.map((field) => findField(lines, field.label, field.patterns));
  const flagResults = flags.map((flag) => findFlag(lines, flag.label, flag.terms));

  const getValue = (label: string) => [...snapshot, ...timeline].find((item) => item.label === label)?.value || notMentioned;
  const getFlag = (label: string) => flagResults.find((item) => item.label === label)?.status || "Not mentioned";

  const missingChecks = [
    ["Collection date", getValue("Cargo collection date")],
    ["Collection time", getValue("Cargo collection time")],
    ["Pickup address", getValue("Collection address")],
    ["Contact person", getValue("Collection contact person")],
    ["Contact number", getValue("Collection contact number")],
    ["Pieces", getValue("Pieces")],
    ["Weight", getValue("Gross weight")],
    ["Dimensions", getValue("Dimensions")],
    ["Commodity", getValue("Commodity")],
    ["Flight date", getValue("Flight date")],
    ["AWB number", getValue("AWB number")],
    ["DG status", getFlag("Dangerous goods / DG / DGR")],
    ["Battery status", getFlag("Battery") === "Mentioned" || getFlag("Lithium battery") === "Mentioned" ? "Mentioned" : notMentioned],
    ["Fumigation status", getFlag("Fumigation") === "Mentioned" || getFlag("ISPM15") === "Mentioned" ? "Mentioned" : notMentioned]
  ];

  const missing = missingChecks.filter(([, value]) => value === notMentioned).map(([label]) => label);
  const checklist = new Set<string>();

  if (getValue("Cargo collection date") !== notMentioned || getValue("Cargo collection time") !== notMentioned) {
    checklist.add("Confirm collection timing");
    checklist.add("Confirm driver arrangement");
  }
  if (getValue("Cut-off time") !== notMentioned) checklist.add("Check cut-off timing");
  if (getValue("Flight number") !== notMentioned || getValue("Flight date") !== notMentioned) checklist.add("Verify booking");
  if (getFlag("Fumigation") === "Mentioned" || getFlag("ISPM15") === "Mentioned") checklist.add("Check fumigation cert");
  if (getFlag("Dangerous goods / DG / DGR") === "Mentioned" || getFlag("DGD") === "Mentioned") checklist.add("Check DG declaration");
  if (getFlag("Battery") === "Mentioned" || getFlag("Lithium battery") === "Mentioned") checklist.add("Check battery documents and airline acceptance");
  if (getFlag("Temperature control") === "Mentioned") checklist.add("Confirm temperature handling instruction");
  if (missing.includes("Dimensions")) checklist.add("Request dimensions");
  if (missing.includes("Contact person") || missing.includes("Contact number")) checklist.add("Request missing contact details");
  if (missing.includes("Pickup address")) checklist.add("Request pickup address");
  if (missing.includes("Pieces") || missing.includes("Weight")) checklist.add("Request missing shipment quantity or weight");
  if (missing.includes("DG status")) checklist.add("Confirm DG status");
  if (missing.includes("Battery status")) checklist.add("Confirm battery status");
  if (missing.includes("Fumigation status")) checklist.add("Confirm fumigation status");

  if (checklist.size === 0) checklist.add("Review extracted evidence before acting");

  return {
    snapshot,
    timeline,
    flags: flagResults,
    missing,
    checklist: Array.from(checklist),
    evidence: uniqueEvidence([...snapshot, ...timeline, ...flagResults]),
    cleanedEmail
  };
}

function buildSummary(result: ExtractionResult) {
  const section = (title: string, rows: string[]) => [`${title}`, ...rows.map((row) => `- ${row}`), ""].join("\n");

  return [
    "Ops Email Extractor Summary",
    "",
    section("Shipment Snapshot", result.snapshot.map((item) => `${item.label}: ${item.value}`)),
    section("Operational Timeline", result.timeline.map((item) => `${item.label}: ${item.value}`)),
    section("Special Handling Flags", result.flags.map((item) => `${item.label}: ${item.status}${item.evidence ? ` | Line ${item.evidence.line}: ${item.evidence.text}` : ""}`)),
    section("Missing Information", result.missing.length ? result.missing : ["None based on configured checks"]),
    section("Action Checklist", result.checklist),
    section("Evidence", result.evidence.map((item) => `Line ${item.line}: ${item.text}`)),
    section("Cleaned Email Preview", result.cleanedEmail ? result.cleanedEmail.split("\n") : ["No analyzable text after cleaning"])
  ].join("\n");
}

export default function Home() {
  const [emailText, setEmailText] = useState("");
  const [fileName, setFileName] = useState("");
  const [message, setMessage] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const summaryText = useMemo(() => (result ? buildSummary(result) : ""), [result]);

  async function handleFile(file: File) {
    setMessage("");
    setFileName(file.name);
    setResult(null);
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

  function runExtraction() {
    if (!emailText.trim()) {
      setMessage("Paste, upload, or drag an email thread before extracting.");
      return;
    }
    setResult(extractDetails(emailText));
    setMessage("Extraction complete. Only explicitly mentioned details are shown.");
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
          <span>Local freight instruction parser</span>
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
            <button type="button" onClick={runExtraction}>
              Extract Ops Details
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
              <h2>Structured ops summary</h2>
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
              <p>Paste, upload, or drag an email thread, then extract. Missing or unconfirmed items will stay marked as not mentioned.</p>
            </div>
          ) : (
            <div className="results">
              <SummaryCard title="Shipment Snapshot" items={result.snapshot} />
              <SummaryCard title="Operational Timeline" items={result.timeline} />

              <article className="card wide">
                <div className="cardTitle">
                  <h3>Special Handling Flags</h3>
                  <span className="count">{result.flags.filter((flag) => flag.status === "Mentioned").length} mentioned</span>
                </div>
                <div className="flagGrid">
                  {result.flags.map((flag) => (
                    <div className="flagItem" key={flag.label}>
                      <div>
                        <strong>{flag.label}</strong>
                        <p>{flag.evidence ? `Line ${flag.evidence.line}: ${flag.evidence.text}` : "No explicit phrase found"}</p>
                      </div>
                      <span className={`badge ${flag.severity}`}>{flag.status}</span>
                    </div>
                  ))}
                </div>
              </article>

              <article className="card">
                <div className="cardTitle">
                  <h3>Missing Information</h3>
                  <span className="badge missing">{result.missing.length} missing</span>
                </div>
                <div className="missingGrid">
                  {result.missing.length ? result.missing.map((item) => <span key={item}>{item}</span>) : <p>No configured missing items detected.</p>}
                </div>
              </article>

              <article className="card">
                <div className="cardTitle">
                  <h3>Action Checklist</h3>
                </div>
                <ul className="checklist">
                  {result.checklist.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>

              <article className="card wide">
                <div className="cardTitle">
                  <h3>Evidence Panel</h3>
                  <span className="count">{result.evidence.length} lines</span>
                </div>
                <div className="evidenceList">
                  {result.evidence.length ? (
                    result.evidence.map((item) => (
                      <div key={`${item.line}-${item.text}`} className="evidenceLine">
                        <span>Line {item.line}</span>
                        <p>{item.text}</p>
                      </div>
                    ))
                  ) : (
                    <p>No explicit configured details found.</p>
                  )}
                </div>
              </article>

              <details className="card wide cleanedPreview">
                <summary>Cleaned Email Preview</summary>
                <pre>{result.cleanedEmail || "No analyzable text after cleaning."}</pre>
              </details>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function SummaryCard({ title, items }: { title: string; items: FieldValue[] }) {
  const mentioned = items.filter((item) => item.value !== notMentioned).length;

  return (
    <article className="card">
      <div className="cardTitle">
        <h3>{title}</h3>
        <span className="count">{mentioned} found</span>
      </div>
      <div className="dataTable">
        {items.map((item) => (
          <div className="dataRow" key={item.label}>
            <span>{item.label}</span>
            <strong className={item.value === notMentioned ? "mutedValue" : ""}>{item.value}</strong>
            <small>{item.evidence ? `Line ${item.evidence.line}` : "Not mentioned"}</small>
          </div>
        ))}
      </div>
    </article>
  );
}
