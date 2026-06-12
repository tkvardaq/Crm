import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LEAD_FIELDS = ["email", "firstName", "lastName", "phone", "company"] as const;
type LeadField = (typeof LEAD_FIELDS)[number];

interface ParsedRow {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  company?: string;
}

interface RowError {
  row: number;
  message: string;
}

function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      cols.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cols.push(current.trim());
  return cols;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "CSV file is required" }, { status: 400 });
  }

  const mappingRaw = formData.get("mapping");
  if (!mappingRaw || typeof mappingRaw !== "string") {
    return NextResponse.json({ error: "Field mapping is required" }, { status: 400 });
  }

  let mapping: Record<string, string>;
  try {
    mapping = JSON.parse(mappingRaw);
  } catch {
    return NextResponse.json({ error: "Invalid mapping format" }, { status: 400 });
  }

  const mappingEntries = Object.entries(mapping).filter(
    ([, field]) => LEAD_FIELDS.includes(field as LeadField)
  );

  const emailCol = mappingEntries.find(([, f]) => f === "email")?.[0];
  if (!emailCol) {
    return NextResponse.json({ error: "Email field mapping is required" }, { status: 400 });
  }

  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return NextResponse.json(
      { error: "CSV must have a header and at least one data row" },
      { status: 400 }
    );
  }

  const headers = parseCsvLine(lines[0]);

  const colIndex: Record<string, number> = {};
  headers.forEach((h, i) => {
    colIndex[h.toLowerCase()] = i;
  });

  const fieldToCol: Partial<Record<LeadField, number>> = {};
  for (const [colName, field] of mappingEntries) {
    const idx = colIndex[colName.toLowerCase()];
    if (idx !== undefined) {
      fieldToCol[field as LeadField] = idx;
    }
  }

  if (fieldToCol.email === undefined) {
    return NextResponse.json(
      { error: "Mapped email column not found in CSV headers" },
      { status: 400 }
    );
  }

  const validRows: ParsedRow[] = [];
  const errors: RowError[] = [];
  let skippedCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const row = i + 1;

    const emailRaw = cols[fieldToCol.email!] || "";
    const email = emailRaw.toLowerCase().trim();

    if (!email) {
      errors.push({ row, message: "Missing email" });
      continue;
    }
    if (!EMAIL_RE.test(email)) {
      errors.push({ row, message: `Invalid email: ${emailRaw}` });
      continue;
    }

    const firstName = fieldToCol.firstName !== undefined ? (cols[fieldToCol.firstName] || "").trim() : undefined;
    const lastName = fieldToCol.lastName !== undefined ? (cols[fieldToCol.lastName] || "").trim() : undefined;
    const phone = fieldToCol.phone !== undefined ? (cols[fieldToCol.phone] || "").trim() : undefined;
    const company = fieldToCol.company !== undefined ? (cols[fieldToCol.company] || "").trim() : undefined;

    if (validRows.some((r) => r.email === email)) {
      skippedCount++;
      continue;
    }

    validRows.push({
      email,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      phone: phone || undefined,
      company: company || undefined,
    });
  }

  if (validRows.length === 0) {
    return NextResponse.json({
      created: 0,
      skipped: skippedCount,
      errors: errors.slice(0, 50),
      message: "No valid leads to import",
    }, { status: 400 });
  }

  let created: number;
  try {
    const result = await prismaClient.$transaction(async (tx) => {
      const insertedLeads: { id: string; email: string }[] = [];

      for (const r of validRows) {
        let companyId: string | null = null;
        if (r.company) {
          const existing = await tx.company.findFirst({
            where: { workspaceId, name: { equals: r.company, mode: "insensitive" } },
          });
          if (existing) {
            companyId = existing.id;
          } else {
            const created = await tx.company.create({
              data: { workspaceId, name: r.company },
              select: { id: true },
            });
            companyId = created.id;
          }
        }

        const lead = await tx.lead.upsert({
          where: { workspaceId_email: { workspaceId, email: r.email } },
          create: {
            workspaceId,
            email: r.email,
            firstName: r.firstName || null,
            lastName: r.lastName || null,
            phone: r.phone || null,
            status: "raw",
            companyId,
          },
          update: {},
          select: { id: true, email: true },
        });
        insertedLeads.push(lead);
      }

      return { count: insertedLeads.length };
    });
    created = result.count;
  } catch (err) {
    console.error("Import error:", err);
    return NextResponse.json({ error: "Database error during import" }, { status: 500 });
  }

  skippedCount += validRows.length - created;

  return NextResponse.json({
    created,
    skipped: skippedCount,
    errors: errors.slice(0, 50),
  });
}
