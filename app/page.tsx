"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import MsgReader from "msgreader";
import MsgReaderConst from "msgreader/lib/const";

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
  source: "Quick Extract" | "AI Deep Extract";
  basics: FieldValue[];
  delivery: FieldValue[];
  flight: FieldValue[];
  flags: FlagResult[];
  permit: FieldValue[];
  opsNotes: Evidence[];
  evidence: Evidence[];
  cleanedEmail: string;
};

const notMentioned = "Not mentioned";

const basicsFields = [
  {
    label: "AWB / HAWB",
    patterns: [
      /\b(?:mawb|awb|air waybill)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([0-9]{3}-[0-9]{8})\b/i,
      /\b(?:hawb|house awb)\s*(?:no\.?|number|#)?\s*[:#\-]?\s*([A-Z0-9-]{4,})\b/i,
      /\b(SGMTCT[0-9A-Z]{4,})\b/i
    ]
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
    label: "Pieces",
    patterns: [/\b(?:pieces|piece|pcs|pkgs|packages)\s*[:\-]?\s*([0-9,]+\s*(?:pcs|pieces|pkgs|packages|ctns|cartons)?)\b/i]
  },
  {
    label: "Weight",
    patterns: [/\b(?:gross weight|g\/w|gw|weight|wt)\s*[:\-]?\s*([0-9,.]+\s*(?:kgs?|kg|lbs?|lb))\b/i]
  },
  {
    label: "Commodity",
    patterns: [/^\s*(commodity|goods description|description of goods)\s*[:\-]\s*(.+)$/i]
  }
];

const deliveryFields = [
  {
    label: "Delivery type",
    patterns: [/\b(arrange collection|collection|pickup|pick up|collect|truck in|self[-\s]?deliver|send to warehouse|deliver cargo|delivery)\b/i]
  },
  {
    label: "Collection / Delivery date",
    patterns: [/\b(?:collection date|pickup date|pick up date|collect on|cargo ready date|truck in date|truck date|delivery date|deliver cargo on|send to warehouse on)\s*[:\-]?\s*(.+)$/i]
  },
  {
    label: "Collection / Delivery time",
    patterns: [/\b(?:collection time|pickup time|pick up time|collect at|cargo ready time|truck in time|truck time|delivery time|deliver cargo at|send to warehouse at)\s*[:\-]?\s*(.+)$/i]
  }
];

const flightFields = [
  {
    label: "Flight date",
    patterns: [/\b(?:flight date|flt date|flight on|departure date|uplift date)\s*[:\-]?\s*(.+)$/i]
  },
  {
    label: "Flight number",
    patterns: [/\b(?:flight|flt|flight no\.?|flight number)\s*[:\-]?\s*([A-Z0-9]{2,3}\s?[0-9]{2,4}[A-Z]?)\b/i]
  },
  {
    label: "Cut-off",
    patterns: [/\b(?:cut[-\s]?off|cut off time|closing time)\s*[:\-]?\s*(.+)$/i]
  }
];

const flags = [
  { label: "Battery / Lithium", terms: ["battery", "batteries", "lithium", "lithium ion", "lithium metal", "UN3480", "UN3481"] },
  { label: "DG / DGR", terms: ["dangerous goods", "dgr", "dg", "dgd", "msds", "un number"] },
  { label: "Fumigation", terms: ["fumigation", "fumigated", "fumigation cert", "ISPM15", "ISPM 15"] },
  { label: "Perishable", terms: ["perishable", "fresh", "food", "meat", "seafood", "vegetable"] },
  { label: "Temperature control", terms: ["temp", "temperature", "chilled", "frozen", "cool", "ambient"] },
  { label: "Non-stackable", terms: ["non-stackable", "non stackable", "not stackable"] },
  { label: "Pivot weight", terms: ["pivot weight"] }
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
Cut-off time: 16:00
Flight date: 05 Jul 2026
Flight: SQ326
ETD: 23:55
ETA: 06 Jul 2026 06:20

Fumigation cert will follow.
Battery packed with equipment. MSDS attached.
Cargo is non-stackable.
Permit under shipper account.
Export ops pls take note: check fumigation cert before lodge-in.

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

  const readableCharacters = normalized.replace(/\s/g, "").length;
  if (readableCharacters < 10) {
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

  const preferredBody = data.htmlBody ? htmlToVisibleText(data.htmlBody) : data.body;
  const body = normalizeVisibleMsgBody(preferredBody);

  return body;
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

function valueFromMatch(label: string, match: RegExpMatchArray) {
  if ((label === "Origin" || label === "Destination") && match[1] && match[2] && /^[A-Z]{3}$/.test(match[1]) && /^[A-Z]{3}$/.test(match[2])) {
    return label === "Origin" ? match[1] : match[2];
  }

  return match[2] || match[1] || "";
}

function hasCollectionContext(line: string) {
  return /\b(collection|pickup|pick up|collect|truck|driver|cargo ready|delivery|warehouse)\b/i.test(line);
}

function detectDeliveryType(lines: string[]): FieldValue {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/\b(self[-\s]?deliver|send to warehouse|deliver cargo|truck in)\b/i.test(line)) {
      return {
        label: "Delivery type",
        value: "Self-delivery",
        evidence: { line: index + 1, text: line }
      };
    }
    if (/\b(arrange collection|collection|pickup|pick up|collect)\b/i.test(line)) {
      return {
        label: "Delivery type",
        value: "Collection",
        evidence: { line: index + 1, text: line }
      };
    }
  }

  return { label: "Delivery type", value: notMentioned };
}

function detectAwbHawb(lines: string[]): FieldValue {
  let awb: FieldValue | null = null;
  let hawb: FieldValue | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!awb) {
      const match = line.match(/\b(?:mawb|awb|air waybill)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([0-9]{3}-[0-9]{8})\b/i);
      if (match) awb = { label: "AWB / HAWB", value: `AWB: ${match[1]}`, evidence: { line: index + 1, text: line } };
    }
    if (!hawb) {
      const match = line.match(/\b(?:hawb|house awb)\s*(?:no\.?|number|#)?\s*[:#\-]?\s*([A-Z0-9-]{4,})\b/i) || line.match(/\b(SGMTCT[0-9A-Z]{4,})\b/i);
      if (match) hawb = { label: "AWB / HAWB", value: `HAWB: ${match[1]}`, evidence: { line: index + 1, text: line } };
    }
  }

  const values = [awb?.value, hawb?.value].filter(Boolean);
  if (!values.length) return { label: "AWB / HAWB", value: notMentioned };

  return {
    label: "AWB / HAWB",
    value: values.join(" / "),
    evidence: awb?.evidence || hawb?.evidence
  };
}

function detectPermit(lines: string[]): FieldValue[] {
  const permitMention = findFlag(lines, "Permit", ["permit", "export permit"]);
  if (permitMention.status === "Not mentioned") {
    return [
      { label: "Permit status", value: notMentioned },
      { label: "Declaration responsibility", value: notMentioned },
      { label: "Type of permit", value: notMentioned }
    ];
  }

  let responsibility = "Permit mentioned - declaration responsibility unclear";
  let responsibilityEvidence = permitMention.evidence;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/\b(permit under shipper account|shipper self declare|shipper self[-\s]?declared|self declare permit)\b/i.test(line)) {
      responsibility = "Permit self-declared by shipper";
      responsibilityEvidence = { line: index + 1, text: line };
      break;
    }
    if (/\b(please declare permit|permit under our permit|we declare permit|ops declare permit|export ops.*declare permit|declare export permit)\b/i.test(line)) {
      responsibility = "Permit to be declared by us / export ops";
      responsibilityEvidence = { line: index + 1, text: line };
      break;
    }
  }

  const typeField = findField(lines, "Type of permit", [/\b(export permit|import permit|transhipment permit|strategic goods permit|permit)\b/i]);

  return [
    { label: "Permit status", value: "Permit required", evidence: permitMention.evidence },
    { label: "Declaration responsibility", value: responsibility, evidence: responsibilityEvidence },
    typeField.value === notMentioned ? { label: "Type of permit", value: notMentioned } : typeField
  ];
}

function findOpsNotes(lines: string[]): Evidence[] {
  const notes: Evidence[] = [];
  const patterns = [
    /\b(export ops pls take note|export ops please take note|ops please note|ops pls note|pls take note|please take note|team please note|warehouse please note)\b/i,
    /^\s*(important|note)\s*[:\-]/i
  ];

  lines.forEach((line, index) => {
    if (patterns.some((pattern) => pattern.test(line))) {
      notes.push({ line: index + 1, text: line });
    }
  });

  return notes;
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

  const basics = basicsFields.map((field) => (field.label === "AWB / HAWB" ? detectAwbHawb(lines) : findField(lines, field.label, field.patterns)));
  const delivery = deliveryFields.map((field) => (field.label === "Delivery type" ? detectDeliveryType(lines) : findField(lines, field.label, field.patterns)));
  const flight = flightFields.map((field) => findField(lines, field.label, field.patterns));
  const flagResults = flags.map((flag) => findFlag(lines, flag.label, flag.terms));
  const mentionedFlags = flagResults.filter((flag) => flag.status === "Mentioned");
  const permit = detectPermit(lines);
  const opsNotes = findOpsNotes(lines);

  return {
    source: "Quick Extract",
    basics,
    delivery,
    flight,
    flags: mentionedFlags,
    permit,
    opsNotes,
    evidence: uniqueEvidence([...basics, ...delivery, ...flight, ...mentionedFlags, ...permit, ...opsNotes.map((evidence) => ({ label: "Export Ops Note", value: evidence.text, evidence }))]),
    cleanedEmail
  };
}

function buildSummary(result: ExtractionResult) {
  const section = (title: string, rows: string[]) => [`${title}`, ...rows.map((row) => `- ${row}`), ""].join("\n");

  return [
    "Ops Email Extractor Summary",
    `Mode: ${result.source}`,
    "",
    section("Shipment Basics", result.basics.map((item) => `${item.label}: ${item.value}`)),
    section("Delivery Method", result.delivery.map((item) => `${item.label}: ${item.value}`)),
    section("Flight Details", result.flight.map((item) => `${item.label}: ${item.value}`)),
    section("Critical Cargo Flags", result.flags.length ? result.flags.map((item) => `${item.label}: ${item.status}${item.evidence ? ` | Line ${item.evidence.line}: ${item.evidence.text}` : ""}`) : ["No critical cargo flags explicitly mentioned"]),
    section("Permit Declaration", result.permit.map((item) => `${item.label}: ${item.value}`)),
    section("Export Ops Notes", result.opsNotes.length ? result.opsNotes.map((item) => `Line ${item.line}: ${item.text}`) : ["No direct export ops notes found"]),
    section("Evidence", result.evidence.map((item) => `Line ${item.line}: ${item.text}`)),
    section("Cleaned Email Preview", result.cleanedEmail ? result.cleanedEmail.split("\n") : ["No analyzable text after cleaning"])
  ].join("\n");
}

export default function Home() {
  const [emailText, setEmailText] = useState("");
  const [fileName, setFileName] = useState("");
  const [message, setMessage] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isDeepExtracting, setIsDeepExtracting] = useState(false);
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
    setMessage("Quick extraction complete. Only explicitly mentioned details are shown.");
  }

  async function runDeepExtraction() {
    if (!emailText.trim()) {
      setMessage("Paste, upload, or drag an email thread before extracting.");
      return;
    }

    setIsDeepExtracting(true);
    setMessage("AI Deep Extract is analyzing explicit details only.");

    try {
      const cleanedEmail = cleanEmailForAnalysis(emailText);
      const response = await fetch("/api/deep-extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ cleanedEmail })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "AI Deep Extract failed.");
      }

      setResult(payload.result as ExtractionResult);
      setMessage("AI Deep Extract complete. Every extracted field includes evidence.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI Deep Extract failed.");
    } finally {
      setIsDeepExtracting(false);
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
              Quick Extract
            </button>
            <button className="secondaryButton" type="button" onClick={runDeepExtraction} disabled={isDeepExtracting}>
              {isDeepExtracting ? "AI Extracting..." : "AI Deep Extract"}
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
              <article className="card wide resultMode">
                <span>{result.source}</span>
                <p>{result.source === "AI Deep Extract" ? "OpenAI structured JSON extraction with evidence required for every extracted field." : "Local keyword and regex extraction, no API call."}</p>
              </article>

              <SummaryCard title="Shipment Basics" items={result.basics} />
              <SummaryCard title="Delivery Method" items={result.delivery} />
              <SummaryCard title="Flight Details" items={result.flight} />

              <article className="card wide">
                <div className="cardTitle">
                  <h3>Critical Cargo Flags</h3>
                  <span className="count">{result.flags.length} mentioned</span>
                </div>
                {result.flags.length ? (
                  <div className="flagGrid">
                    {result.flags.map((flag) => (
                      <div className="flagItem" key={flag.label}>
                        <div>
                          <strong>{flag.label}</strong>
                          <p>{flag.evidence && flag.evidence.line > 0 ? `Line ${flag.evidence.line}: ${flag.evidence.text}` : "No explicit phrase found"}</p>
                        </div>
                        <span className={`badge ${flag.severity}`}>{flag.status}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="quietText">No critical cargo flags explicitly mentioned.</p>
                )}
              </article>

              <article className="card">
                <div className="cardTitle">
                  <h3>Permit Declaration</h3>
                </div>
                <div className="dataTable">
                  {result.permit.map((item) => (
                    <div className="dataRow" key={item.label}>
                      <span>{item.label}</span>
                      <strong className={item.value === notMentioned ? "mutedValue" : ""}>{item.value}</strong>
                      <small>{item.evidence && item.evidence.line > 0 ? `Line ${item.evidence.line}` : "Not mentioned"}</small>
                    </div>
                  ))}
                </div>
              </article>

              <article className="card">
                <div className="cardTitle">
                  <h3>Export Ops Notes</h3>
                  <span className="count">{result.opsNotes.length} found</span>
                </div>
                {result.opsNotes.length ? (
                  <div className="evidenceList">
                    {result.opsNotes.map((item) => (
                      <div key={`${item.line}-${item.text}`} className="evidenceLine">
                        <span>Line {item.line}</span>
                        <p>{item.text}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="quietText">No direct export ops notes found.</p>
                )}
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
            <small>{item.evidence && item.evidence.line > 0 ? `Line ${item.evidence.line}` : "Not mentioned"}</small>
          </div>
        ))}
      </div>
    </article>
  );
}
