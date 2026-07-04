import { NextResponse } from "next/server";

const basicsLabels = ["AWB / HAWB", "Origin", "Destination", "Pieces", "Weight", "Commodity"];
const deliveryLabels = ["Delivery type", "Collection / Delivery date", "Collection / Delivery time"];
const flightLabels = ["Flight date", "Flight number", "Cut-off"];
const flagLabels = ["Battery / Lithium", "DG / DGR", "Fumigation", "Perishable", "Temperature control", "Non-stackable", "Pivot weight"];
const permitLabels = ["Permit status", "Declaration responsibility", "Type of permit"];

const evidenceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["line", "text"],
  properties: {
    line: { type: "number" },
    text: { type: "string" }
  }
};

const fieldSchema = (labels: string[]) => ({
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["label", "value", "evidence"],
    properties: {
      label: { type: "string", enum: labels },
      value: { type: "string" },
      evidence: evidenceSchema
    }
  }
});

const extractionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["source", "basics", "delivery", "flight", "flags", "permit", "opsNotes", "evidence", "cleanedEmail"],
  properties: {
    source: { type: "string", enum: ["AI Deep Extract"] },
    basics: fieldSchema(basicsLabels),
    delivery: fieldSchema(deliveryLabels),
    flight: fieldSchema(flightLabels),
    flags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "status", "phrase", "evidence", "severity"],
        properties: {
          label: { type: "string", enum: flagLabels },
          status: { type: "string", enum: ["Mentioned"] },
          phrase: { type: "string" },
          evidence: evidenceSchema,
          severity: { type: "string", enum: ["critical", "attention"] }
        }
      }
    },
    permit: fieldSchema(permitLabels),
    opsNotes: {
      type: "array",
      items: evidenceSchema
    },
    evidence: {
      type: "array",
      items: evidenceSchema
    },
    cleanedEmail: { type: "string" }
  }
};

function lineNumberEmail(text: string) {
  return text
    .split("\n")
    .map((line, index) => `${index + 1}: ${line}`)
    .join("\n");
}

function safeEvidence(value: unknown) {
  const evidence = value as { line?: unknown; text?: unknown };
  return {
    line: typeof evidence?.line === "number" ? evidence.line : 0,
    text: typeof evidence?.text === "string" ? evidence.text : ""
  };
}

function normalizeFields(items: unknown, requiredLabels: string[]) {
  const rows = Array.isArray(items) ? items : [];
  return requiredLabels.map((label) => {
    const match = rows.find((item: any) => item?.label === label);
    return {
      label,
      value: typeof match?.value === "string" ? match.value : "Not mentioned",
      evidence: safeEvidence(match?.evidence)
    };
  });
}

function normalizeAiResult(result: any, cleanedEmail: string) {
  const flags = Array.isArray(result.flags)
    ? result.flags
        .filter((item: any) => item?.status === "Mentioned")
        .map((item: any) => ({ ...item, evidence: safeEvidence(item.evidence), severity: item.severity === "attention" ? "attention" : "critical" }))
    : [];
  const opsNotes = Array.isArray(result.opsNotes)
    ? result.opsNotes.map(safeEvidence).filter((item: { line: number; text: string }) => item.line > 0 && item.text)
    : [];
  const evidence = Array.isArray(result.evidence)
    ? result.evidence.map(safeEvidence).filter((item: { line: number; text: string }) => item.line > 0 && item.text)
    : [];

  return {
    source: "AI Deep Extract" as const,
    basics: normalizeFields(result.basics, basicsLabels),
    delivery: normalizeFields(result.delivery, deliveryLabels),
    flight: normalizeFields(result.flight, flightLabels),
    flags,
    permit: normalizeFields(result.permit, permitLabels),
    opsNotes,
    evidence,
    cleanedEmail
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not set on the server." }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const cleanedEmail = typeof body?.cleanedEmail === "string" ? body.cleanedEmail.trim() : "";

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
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You are an export airfreight operations extraction engine. Return structured JSON only. Do not guess. Do not infer. Extract only operationally relevant export ops information explicitly mentioned in the email. Every extracted value must include exact evidence line number and exact evidence text. Use 'Not mentioned' with line 0 and empty text when absent. Keep output concise."
        },
        {
          role: "user",
          content: `Extract only the requested export ops action-board fields from this cleaned email.\n\nStrict rules:\n- Do not extract shipper, consignee, address, contact person, contact number, urgent, oversized/OOG, or permit as a cargo flag.\n- Shipment Basics only: AWB / HAWB, Origin, Destination, Pieces, Weight, Commodity.\n- Delivery Method only: Delivery type, Collection / Delivery date, Collection / Delivery time.\n- Delivery type must be Collection or Self-delivery only when explicit phrases appear: collect, pickup, truck in, arrange collection, self-deliver, send to warehouse, deliver cargo.\n- Flight Details only: Flight date, Flight number, Cut-off. Do not use email timestamps as flight date.\n- Critical Cargo Flags: return only explicitly mentioned flags from Battery / Lithium, DG / DGR, Fumigation, Perishable, Temperature control, Non-stackable, Pivot weight. Omit flags that are not mentioned.\n- Permit Declaration: detect Permit required, Permit self-declared by shipper, Permit to be declared by us / export ops, Type of permit. If permit is mentioned but responsibility is unclear, set Declaration responsibility to "Permit mentioned - declaration responsibility unclear".\n- Export Ops Notes: return exact lines aimed at ops, including export ops pls take note, ops please note, pls take note, team please note, warehouse please note, important:, note:.\n- Evidence array should include every line used for extracted values and ops notes.\n\nNumbered cleaned email:\n${numberedEmail}`
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "ops_action_board_extraction",
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
  const result = normalizeAiResult(parsed, cleanedEmail);

  return NextResponse.json({ result });
}
