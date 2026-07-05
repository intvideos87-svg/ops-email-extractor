import { NextResponse } from "next/server";

const nullableString = {
  type: ["string", "null"]
};

const flagFieldSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "evidence"],
  properties: {
    status: { type: "string", enum: ["Mentioned", "Not mentioned"] },
    evidence: nullableString
  }
};

const responsibilitySchema = {
  type: ["string", "null"],
  enum: ["Shipper", "Export Ops / Our Side", "Unclear", null]
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
      required: ["type", "date", "time"],
      properties: {
        type: nullableString,
        date: nullableString,
        time: nullableString
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
      required: ["batteries_lithium", "dg_dgr", "msds_dgd", "fumigation_ispm15", "perishable", "temperature_control", "non_stackable", "pivot_weight"],
      properties: {
        batteries_lithium: flagFieldSchema,
        dg_dgr: flagFieldSchema,
        msds_dgd: flagFieldSchema,
        fumigation_ispm15: flagFieldSchema,
        perishable: flagFieldSchema,
        temperature_control: flagFieldSchema,
        non_stackable: flagFieldSchema,
        pivot_weight: flagFieldSchema
      }
    },
    permit_declaration: {
      type: "object",
      additionalProperties: false,
      required: ["mentioned", "responsibility"],
      properties: {
        mentioned: { type: "boolean" },
        responsibility: responsibilitySchema
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

function normalizeFlag(value: any) {
  const mentioned = value?.status === "Mentioned";
  return {
    status: mentioned ? "Mentioned" : "Not mentioned",
    evidence: mentioned ? normalizeString(value?.evidence) : null
  };
}

function normalizeFlightNumber(value: unknown) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  const match = normalized.match(/\b([A-Z0-9]{2,3})\s*([0-9]{2,4}[A-Z]?)\b/i);
  return match ? `${match[1].toUpperCase()}${match[2]}` : normalized;
}

function normalizeResponsibility(value: unknown, permitMentioned: boolean) {
  if (!permitMentioned) return null;
  if (value === "Shipper" || value === "Export Ops / Our Side" || value === "Unclear") return value;
  return "Unclear";
}

function normalizeResult(result: any) {
  const permitMentioned = result?.permit_declaration?.mentioned === true;

  return {
    shipment_basics: {
      awb: normalizeString(result?.shipment_basics?.awb),
      hawb: normalizeString(result?.shipment_basics?.hawb),
      origin: normalizeString(result?.shipment_basics?.origin),
      destination: normalizeString(result?.shipment_basics?.destination),
      pieces: normalizeString(result?.shipment_basics?.pieces),
      weight: normalizeString(result?.shipment_basics?.weight),
      commodity: normalizeString(result?.shipment_basics?.commodity)
    },
    delivery_method: {
      type: normalizeString(result?.delivery_method?.type),
      date: normalizeString(result?.delivery_method?.date),
      time: normalizeString(result?.delivery_method?.time)
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
      pivot_weight: normalizeFlag(result?.critical_flags?.pivot_weight)
    },
    permit_declaration: {
      mentioned: permitMentioned,
      responsibility: normalizeResponsibility(result?.permit_declaration?.responsibility, permitMentioned)
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

  if (!cleanedEmail) {
    return NextResponse.json({ error: "No cleaned email text provided." }, { status: 400 });
  }

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
          content: `Extract this exact JSON structure from the cleaned email body.\n\nGeneral rules:\n- Never guess.\n- Never infer.\n- Only extract explicit information.\n- If not found, return null.\n- Do not use email sent timestamp as flight date.\n- Ignore signatures and disclaimers.\n- Focus only on operational instructions.\n- Delivery type must only be Collection or Self-delivery if explicitly stated by operational phrases such as collect, pickup, truck in, arrange collection, self-deliver, send to warehouse, deliver cargo. Otherwise null.\n- export_ops_notes must contain exact direct instruction lines meant for export ops only.\n\nCritical flag intent rules:\n- Always include all critical flag fields.\n- Status must be "Mentioned" only if the email indicates the cargo ACTUALLY contains it, is declared as it, has the document attached, or requires that handling.\n- If Mentioned, evidence must be the exact source line.\n- If Not mentioned, evidence must be null.\n- Do NOT mark Mentioned for questions, warnings, conditions, rejections, or negative statements.\n- Trigger examples: "cargo contains lithium batteries", "DG attached", "DGD attached", "MSDS attached", "fumigation cert attached", "cargo is perishable", "temp control required".\n- Non-trigger examples: "please ensure cargo has no DGR", "kindly confirm if any battery inside", "if DG, please provide DGD", "do not accept dangerous goods", "ensure no lithium battery".\n- Critical flags are: Batteries / Lithium, DG / DGR, MSDS / DGD, Fumigation / ISPM15, Perishable, Temperature control, Non-stackable, Pivot weight.\n\nPermit responsibility rules:\n- permit_declaration.mentioned is true only if permit is explicitly discussed.\n- responsibility must be one of: "Shipper", "Export Ops / Our Side", "Unclear", or null when permit not mentioned.\n- "permit to follow" means Export Ops / Our Side when written as an internal/customer-service promise.\n- "shipper will self declare permit" means Shipper.\n- "permit under shipper account" means Shipper.\n- "we will declare permit" means Export Ops / Our Side.\n- "please declare permit under our permit" means Export Ops / Our Side.\n- If shipper is explicitly responsible, return Shipper.\n- If internal staff/customer service/our side is promising or arranging the permit, return Export Ops / Our Side.\n- If permit is mentioned but ownership is unclear, return Unclear.\n\nFlight number rules:\n- Flight number must capture the full airline code plus numeric portion. Never return airline code alone if a number exists.\n- Normalize flight number by removing spaces between airline code and number: SQ 0510 -> SQ0510, EK 354 -> EK354, QR 942 -> QR942.\n- Prioritize operational flight lines such as FLIGHT NO., Flight:, Scheduled Departure, and uplift point / discharge point tables.\n- If multiple flights exist, use the latest confirmed/latest operational flight.\n- Do not summarize or truncate flight numbers. SQ is not SQ0510.\n\nCleaned email body:\n${cleanedEmail}`
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
  return NextResponse.json({ result: normalizeResult(parsed) });
}
