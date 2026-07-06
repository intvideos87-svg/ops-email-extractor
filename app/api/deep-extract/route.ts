import { NextResponse } from "next/server";

const nullableString = {
  type: ["string", "null"]
};

const flagFieldSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "interpretation", "evidence", "keyword", "email_context", "line_number"],
  properties: {
    status: { type: "string", enum: ["Mentioned", "Not mentioned"] },
    interpretation: nullableString,
    evidence: nullableString,
    keyword: nullableString,
    email_context: nullableString,
    line_number: { type: ["number", "null"] }
  }
};

const responsibilitySchema = {
  type: ["string", "null"],
  enum: ["Shipper", "UAF / Forwarder", "Pending / To follow", "Unclear", null]
};

const extractionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["shipment_basics", "delivery_method", "flight_details", "critical_flags", "permit_declaration", "export_ops_notes"],
  properties: {
    shipment_basics: {
      type: "object",
      additionalProperties: false,
      required: ["awb", "hawb", "origin", "destination", "pieces", "weight", "commodity"],
      properties: {
        awb: nullableString,
        hawb: nullableString,
        origin: nullableString,
        destination: nullableString,
        pieces: nullableString,
        weight: nullableString,
        commodity: nullableString
      }
    },
    delivery_method: {
      type: "object",
      additionalProperties: false,
      required: ["type", "date", "time", "evidence", "date_basis"],
      properties: {
        type: nullableString,
        date: nullableString,
        time: nullableString,
        evidence: nullableString,
        date_basis: nullableString
      }
    },
    flight_details: {
      type: "object",
      additionalProperties: false,
      required: ["flight_number", "flight_date", "cutoff"],
      properties: {
        flight_number: nullableString,
        flight_date: nullableString,
        cutoff: nullableString
      }
    },
    critical_flags: {
      type: "object",
      additionalProperties: false,
      required: ["batteries_lithium", "dg_dgr", "msds_dgd", "fumigation_ispm15", "perishable", "temperature_control", "non_stackable", "pivot_weight", "magnetized"],
      properties: {
        batteries_lithium: flagFieldSchema,
        dg_dgr: flagFieldSchema,
        msds_dgd: flagFieldSchema,
        fumigation_ispm15: flagFieldSchema,
        perishable: flagFieldSchema,
        temperature_control: flagFieldSchema,
        non_stackable: flagFieldSchema,
        pivot_weight: flagFieldSchema,
        magnetized: flagFieldSchema
      }
    },
    permit_declaration: {
      type: "object",
      additionalProperties: false,
      required: ["mentioned", "responsibility", "evidence"],
      properties: {
        mentioned: { type: "boolean" },
        responsibility: responsibilitySchema,
        evidence: nullableString
      }
    },
    export_ops_notes: {
      type: "array",
      items: { type: "string" }
    }
  }
};

function normalizeString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function extractAwb(value: string) {
  return value.match(/\b\d{3}-\d{8}\b/)?.[0] || null;
}

function extractHawb(value: string) {
  return value.match(/\b(?:HAWB\s*#?|HAWB:|House\s+AWB|HBL)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,})\b/i)?.[1] || null;
}

function normalizeFlag(value: any) {
  const mentioned = value?.status === "Mentioned";
  const evidence = normalizeString(value?.evidence);

  return {
    status: mentioned ? "Mentioned" : "Not mentioned",
    interpretation: normalizeString(value?.interpretation),
    evidence,
    keyword: normalizeString(value?.keyword),
    email_context: normalizeString(value?.email_context) || (evidence ? "Current/latest email" : null),
    line_number: typeof value?.line_number === "number" ? value.line_number : null
  };
}

function normalizeFlightNumber(value: unknown) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  const match = normalized.match(/\b([A-Z0-9]{2,3})\s*([0-9]{2,4}[A-Z]?)\b/i);
  return match ? `${match[1].toUpperCase()}${match[2]}` : normalized;
}

function normalizePieces(value: unknown) {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  const unitMap: Record<string, string> = {
    pallet: "PLT",
    pallets: "PLT",
    plt: "PLT",
    plts: "PLT",
    ctn: "CTN",
    ctns: "CTNS",
    carton: "CTN",
    cartons: "CTNS",
    crate: "CRATE",
    crates: "CRATES",
    skid: "SKID",
    skids: "SKIDS"
  };

  const tableMatch = normalized.match(/\bqty\s*(\d+)\s*type\s*(PLTS?|pallets?|ctns?|cartons?|crates?|skids?)\b/i);
  const match = tableMatch || normalized.match(/\b(\d+)\s*(PLTS?|pallets?|ctns?|cartons?|crates?|skids?)\b/i);
  if (!match) return normalized;

  const unit = unitMap[match[2].toLowerCase()] || match[2].toUpperCase();
  return `${match[1]} ${unit}`;
}

function normalizeResponsibility(value: unknown, permitMentioned: boolean) {
  if (!permitMentioned) return null;
  if (value === "Shipper" || value === "UAF / Forwarder" || value === "Pending / To follow" || value === "Unclear") return value;
  return "Unclear";
}

function lineNumberEmail(text: string) {
  return text
    .split("\n")
    .map((line, index) => `${index + 1}: ${line}`)
    .join("\n");
}

function normalizeResult(result: any, cleanedEmail: string) {
  const permitMentioned = result?.permit_declaration?.mentioned === true;
  const awb = normalizeString(result?.shipment_basics?.awb) || extractAwb(cleanedEmail);
  const hawb = normalizeString(result?.shipment_basics?.hawb) || extractHawb(cleanedEmail);

  return {
    shipment_basics: {
      awb,
      hawb,
      origin: normalizeString(result?.shipment_basics?.origin),
      destination: normalizeString(result?.shipment_basics?.destination),
      pieces: normalizePieces(result?.shipment_basics?.pieces),
      weight: normalizeString(result?.shipment_basics?.weight),
      commodity: normalizeString(result?.shipment_basics?.commodity)
    },
    delivery_method: {
      type: normalizeString(result?.delivery_method?.type),
      date: normalizeString(result?.delivery_method?.date),
      time: normalizeString(result?.delivery_method?.time),
      evidence: normalizeString(result?.delivery_method?.evidence),
      date_basis: normalizeString(result?.delivery_method?.date_basis)
    },
    flight_details: {
      flight_number: normalizeFlightNumber(result?.flight_details?.flight_number),
      flight_date: normalizeString(result?.flight_details?.flight_date),
      cutoff: normalizeString(result?.flight_details?.cutoff)
    },
    critical_flags: {
      batteries_lithium: normalizeFlag(result?.critical_flags?.batteries_lithium),
      dg_dgr: normalizeFlag(result?.critical_flags?.dg_dgr),
      msds_dgd: normalizeFlag(result?.critical_flags?.msds_dgd),
      fumigation_ispm15: normalizeFlag(result?.critical_flags?.fumigation_ispm15),
      perishable: normalizeFlag(result?.critical_flags?.perishable),
      temperature_control: normalizeFlag(result?.critical_flags?.temperature_control),
      non_stackable: normalizeFlag(result?.critical_flags?.non_stackable),
      pivot_weight: normalizeFlag(result?.critical_flags?.pivot_weight),
      magnetized: normalizeFlag(result?.critical_flags?.magnetized)
    },
    permit_declaration: {
      mentioned: permitMentioned,
      responsibility: normalizeResponsibility(result?.permit_declaration?.responsibility, permitMentioned),
      evidence: permitMentioned ? normalizeString(result?.permit_declaration?.evidence) : null
    },
    export_ops_notes: Array.isArray(result?.export_ops_notes) ? result.export_ops_notes.filter((note: unknown) => typeof note === "string" && note.trim()).map((note: string) => note.trim()) : []
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not set on the server." }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const cleanedEmail = typeof body?.cleanedEmail === "string" ? body.cleanedEmail.trim() : "";
  const emailSentDate = typeof body?.emailSentDate === "string" ? body.emailSentDate.trim() : "";

  if (!cleanedEmail) {
    return NextResponse.json({ error: "No cleaned email text provided." }, { status: 400 });
  }

  const numberedEmail = lineNumberEmail(cleanedEmail);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You are an export airfreight operations extraction engine. Return strict JSON only. Never guess. Never infer. Only extract explicit operational instructions from the cleaned email body. If a value is not explicitly found, return null. For critical flags, always return every flag with status 'Mentioned' or 'Not mentioned'. Context and intent matter more than keywords."
        },
        {
          role: "user",
          content: `You are an airfreight export operations assistant.

Your job is not to summarize the whole email.

Your job is to read messy email threads and extract only the information that export operations staff need to act on.

Think like an export ops staff handling an airfreight shipment.

Main goal:
Turn long customer service email threads into a short operational action board.

Strict rules:
- Do not guess.
- Do not assume.
- Only extract information explicitly stated in the email thread.
- If information is not clearly stated, return Not found.
- Ignore signatures, disclaimers, email footers, contact cards, and company marketing text.
- Latest operational instruction takes priority over older thread content.
- Do not treat email sent date as flight date.
- Email sent date may only be used to resolve relative delivery terms like "today" or "tomorrow".

Understand context:
- A keyword alone is not enough.
- "Please ensure cargo is not DG" does NOT mean cargo is DG.
- "If battery, please provide MSDS" does NOT mean battery is present.
- Only mark DG/Battery/Fumigation/etc as mentioned when the cargo actually contains it or requires that handling.

Extract for these sections only:

1. Shipment Basics
- AWB
- HAWB
- Origin
- Destination
- Pieces
- Weight
- Commodity

Subject/header rule:
- Subject line is operational data and must be checked first for AWB, HAWB, route, and weight.
- Always analyze email headers and subject line for AWB/HAWB.
- AWB / MAWB must match 3 digits, hyphen, 8 digits, e.g. 157-50081673, 618-54932150, 023-02781166.
- HAWB must be detected after HAWB #, HAWB#, HAWB:, House AWB, or HBL.
- Example: "157-50081673 // HAWB #SGMCT2607001" means AWB "157-50081673" and HAWB "SGMCT2607001".

2. Delivery Method
Decide if cargo is:
- Collection by us
- Self-delivery by shipper/customer

Extract:
- Type
- Date
- Time
- Evidence

3. Flight Details
Extract:
- Flight Number
- Flight Date
- Cut-off

Flight number must be complete.
Example:
SQ 0510 = SQ0510, not SQ.

4. Critical Cargo Flags
Always evaluate:
- Batteries / Lithium
- DG / DGR
- MSDS / DGD
- Fumigation / ISPM15
- Perishable
- Temperature control
- Non-stackable
- Pivot weight
- Magnetized

For each flag:
- Mentioned only if cargo actually contains/requires it.
- Not mentioned if only asked as a check/warning.
- Provide short evidence when mentioned.

5. Permit Declaration
Only mark permit as mentioned if the word permit/customs permit/export permit is actually present.

Responsibility:
- If UAF staff says permit attached / will declare / declared, responsibility is UAF / Forwarder.
- If customer/shipper says permit attached / to follow / self-declare, responsibility is Shipper.
- If unclear, responsibility is Unclear.
- Never infer permit responsibility from "shipper will deliver" or "collection".

6. Export Ops Notes
Extract direct instructions meant for ops, such as:
- "export ops please take note"
- "please arrange collection"
- "release cargo to us"
- "flight details to follow"
- "bring release order"
- "please amend AWB"
- "please proceed booking"

Output style:
- Short and operational.
- No long essay.
- Evidence-backed.
- Prefer exact values over explanation.
- The result should help ops know what to do next within 10 seconds.

Extract this exact JSON structure from the numbered cleaned email body.

General rules:
- Never guess.
- Never infer.
- Only extract explicit information.
- If not found, return null.
- Do not use email sent timestamp as flight date.
- Ignore signatures and disclaimers.
- Focus only on operational instructions.
- Delivery type must only be Collection or Self-delivery if explicitly stated by operational phrases such as collect, pickup, truck in, arrange collection, self-deliver, send to warehouse, deliver cargo. Otherwise null.
- export_ops_notes must contain exact direct instruction lines meant for export ops only.

Pieces / pallets rules:
- Extract pieces from table-style or sentence-style quantity/package mentions.
- If text shows "1 PLT", "1 pallet", "1 plt", "Qty 1 Type PLT", or "Total 1 pallet", return shipment_basics.pieces as "1 PLT".
- Also detect "2 pallets", "3 ctns", "4 cartons", "1 crate", "1 skid".
- Normalize pallet/plt/pallets to PLT. Keep other package units concise, e.g. 3 CTNS, 4 CTNS, 1 CRATE, 1 SKID.
- Do not leave pieces null when a quantity and package type are explicitly shown.

Relative collection date rules:
- You may use the email sent date ONLY to resolve relative collection/delivery words such as today or tomorrow.
- Email sent date reference: ${emailSentDate || "not available"}.
- Do NOT use email sent date as flight date.
- If text says "tomorrow", "tomorrow morning", or "after 930am tomorrow" in an operational collection/delivery line, resolve the date using the email sent date.
- Example: Email sent Friday, 3 July 2026 7:23 pm + "Cargo only available for collection tomorrow morning after 930am" => delivery_method.type "Collection", date "04 July 2026", time "after 930am".
- For delivery_method.evidence, return the exact source line, e.g. "Cargo only available for collection tomorrow morning after 930am."
- For delivery_method.date_basis, return "Resolved using email sent date: 3 July 2026." when a relative date was resolved. Otherwise null.

Critical flag UI evidence rules:
- Always include all critical flag fields.
- interpretation must be concise, maximum 1-2 lines. Interpret operational meaning; do not just repeat the source text.
- If Mentioned, provide: concise interpretation, exact evidence sentence, highlighted keyword, line_number, and email_context.
- email_context should identify which email in the thread where possible, e.g. "latest email", "reply from customer service", "forwarded customer email". If not possible, use "Current/latest email".
- If Not mentioned because there is no relevant text: interpretation, evidence, keyword, email_context, and line_number must be null.
- If Not mentioned because the text is negative, a restriction, warning, question, or check, keep status "Not mentioned" but provide a concise interpretation, exact evidence sentence, keyword, line_number, and email_context.
- Negative interpretation example for DG: "DGR was mentioned only as a restriction/check. Cargo itself is NOT declared as DG."
- Mentioned interpretation example for batteries: "Shipment contains lithium-ion batteries (UN3481) under PI967 Section II. Battery cargo confirmed."

Critical flag intent rules:
- Status must be "Mentioned" only if the email indicates the cargo ACTUALLY contains it, is declared as it, has the document attached, or requires that handling.
- Do NOT mark Mentioned for questions, warnings, conditions, rejections, or negative statements.
- DG / DGR should be Mentioned only for active DG context such as cargo IS DG, DG handling required, DG packing, DG declaration, DGD, UN number, class/division, or lithium battery declaration.
- DG / DGR must be Not mentioned for negative lines such as "please ensure cargo is not DG", "cargo must not contain DGR", "confirm non-DG", "no dangerous goods".
- Batteries / Lithium must be Mentioned only if actual cargo contains batteries/lithium or lithium battery declaration is required/attached.
- Batteries / Lithium must be Not mentioned for negative or question lines such as "please confirm no batteries" or "ensure no lithium batteries".
- Magnetized must be Mentioned only if actual cargo is magnetized/magnetic or UN2807/magnetic field is declared. Keywords: magnetized, magnetic, magnet, magnetic field, UN2807.
- Other trigger examples: "DG attached", "DGD attached", "MSDS attached", "fumigation cert attached", "cargo is perishable", "temp control required".
- Non-trigger examples: "kindly confirm if any battery inside", "if DG, please provide DGD", "do not accept dangerous goods".
- Critical flags are: Batteries / Lithium, DG / DGR, MSDS / DGD, Fumigation / ISPM15, Perishable, Temperature control, Non-stackable, Pivot weight, Magnetized.

Permit responsibility rules:
- permit_declaration.mentioned is true only if permit is explicitly discussed.
- responsibility must be one of: "Shipper", "UAF / Forwarder", "Pending / To follow", "Unclear", or null when permit not mentioned.
- permit_declaration.evidence must be the exact sentence used to decide responsibility.
- "permit to follow" means Pending / To follow.
- "shipper will provide permit", "shipper will self declare permit", and "permit under shipper account" mean Shipper.
- "we will declare permit", "pls arrange permit", "please declare permit under our permit", or our-side/internal instruction to arrange/declare permit means UAF / Forwarder.
- If ownership is unclear, return Unclear.

Flight number rules:
- Flight number must capture the full airline code plus numeric portion. Never return airline code alone if a number exists.
- Normalize flight number by removing spaces between airline code and number: SQ 0510 -> SQ0510, EK 354 -> EK354, QR 942 -> QR942.
- Prioritize operational flight lines such as FLIGHT NO., Flight:, Scheduled Departure, and uplift point / discharge point tables.
- If multiple flights exist, use the latest confirmed/latest operational flight.
- Do not summarize or truncate flight numbers. SQ is not SQ0510.

Numbered cleaned email body:
${numberedEmail}`
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "ops_email_ai_extraction",
          strict: true,
          schema: extractionSchema
        }
      }
    })
  });

  const responseJson = await response.json().catch(() => null);

  if (!response.ok) {
    return NextResponse.json({ error: responseJson?.error?.message || "OpenAI extraction failed." }, { status: response.status });
  }

  const outputText = responseJson?.output_text || responseJson?.output?.flatMap((item: any) => item.content || []).find((content: any) => content.type === "output_text")?.text;

  if (typeof outputText !== "string") {
    return NextResponse.json({ error: "OpenAI did not return JSON text." }, { status: 502 });
  }

  const parsed = JSON.parse(outputText);
  return NextResponse.json({ result: normalizeResult(parsed, cleanedEmail) });
}
