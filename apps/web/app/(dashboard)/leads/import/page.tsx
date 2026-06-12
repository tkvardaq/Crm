"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";

const LEAD_FIELDS = [
  { value: "email", label: "Email" },
  { value: "firstName", label: "First Name" },
  { value: "lastName", label: "Last Name" },
  { value: "phone", label: "Phone" },
  { value: "company", label: "Company" },
] as const;

type Stage = "upload" | "mapping" | "preview" | "importing" | "result";

interface ImportResult {
  created: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

export default function LeadsImportPage() {
  const [stage, setStage] = useState<Stage>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseCsvText = (text: string) => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return { headers: [], rows: [] };

    const parseLine = (line: string): string[] => {
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
    };

    const headers = parseLine(lines[0]);
    const rows = lines.slice(1).map(parseLine);
    return { headers, rows };
  };

  const handleFile = useCallback((f: File) => {
    if (!f.name.endsWith(".csv")) {
      setError("Please upload a CSV file");
      return;
    }
    setFile(f);
    setError(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { headers, rows } = parseCsvText(text);
      setCsvHeaders(headers);
      setCsvRows(rows);

      const autoMapping: Record<string, string> = {};
      headers.forEach((h) => {
        const lower = h.toLowerCase().replace(/[^a-z]/g, "");
        if (lower === "email" || lower === "emailaddress") autoMapping[h] = "email";
        else if (lower === "firstname" || lower === "fname" || lower === "first") autoMapping[h] = "firstName";
        else if (lower === "lastname" || lower === "lname" || lower === "last") autoMapping[h] = "lastName";
        else if (lower === "phone" || lower === "phonenumber" || lower === "tel") autoMapping[h] = "phone";
        else if (lower === "company" || lower === "organization" || lower === "org" || lower === "employer") autoMapping[h] = "company";
      });
      setMapping(autoMapping);
      setStage("mapping");
    };
    reader.readAsText(f);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const updateMapping = (col: string, field: string) => {
    setMapping((prev) => {
      const next = { ...prev };
      if (field === "_skip") {
        delete next[col];
      } else {
        Object.keys(next).forEach((k) => {
          if (next[k] === field) delete next[k];
        });
        next[col] = field;
      }
      return next;
    });
  };

  const hasEmailMapping = Object.values(mapping).includes("email");

  const handleImport = async () => {
    setStage("importing");
    setError(null);

    const formData = new FormData();
    formData.append("file", file!);
    formData.append("mapping", JSON.stringify(mapping));

    try {
      const res = await fetch("/api/leads/import", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Import failed");
        setStage("preview");
        return;
      }

      const data: ImportResult = await res.json();
      setResult(data);
      setStage("result");
    } catch {
      setError("Network error during import");
      setStage("preview");
    }
  };

  const reset = () => {
    setStage("upload");
    setFile(null);
    setCsvHeaders([]);
    setCsvRows([]);
    setMapping({});
    setResult(null);
    setError(null);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Import Leads</h1>
          <p className="text-sm text-slate-500 mt-0.5">Upload a CSV file to bulk-import leads</p>
        </div>
        <Link
          href="/leads"
          className="text-sm text-slate-600 hover:text-slate-900 transition-colors"
        >
          &larr; Back to Leads
        </Link>
      </div>

      {stage === "upload" && (
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
              dragOver
                ? "border-blue-400 bg-blue-50"
                : "border-slate-300 hover:border-slate-400"
            }`}
          >
            <div className="flex flex-col items-center gap-3">
              <svg className="w-10 h-10 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-slate-700">
                  {dragOver ? "Drop your CSV here" : "Drag & drop your CSV file here"}
                </p>
                <p className="text-sm text-slate-500 mt-1">or click to browse</p>
              </div>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleInputChange}
            className="hidden"
          />
          {error && (
            <p className="mt-3 text-sm text-red-600">{error}</p>
          )}
        </div>
      )}

      {(stage === "mapping" || stage === "preview") && (
        <>
          <div className="bg-white rounded-xl border shadow-sm p-6 mb-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Map CSV Columns</h2>
              <span className="text-sm text-slate-500">{file?.name}</span>
            </div>
            <p className="text-sm text-slate-500 mb-4">
              Map your CSV columns to lead fields. The <strong>email</strong> field is required.
            </p>
            <div className="space-y-3">
              {csvHeaders.map((header) => (
                <div key={header} className="flex items-center gap-4">
                  <div className="w-1/3 text-sm font-medium text-slate-700 truncate" title={header}>
                    {header}
                  </div>
                  <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                  <select
                    value={mapping[header] || "_skip"}
                    onChange={(e) => updateMapping(header, e.target.value)}
                    className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="_skip">— Skip —</option>
                    {LEAD_FIELDS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            {!hasEmailMapping && (
              <p className="mt-3 text-sm text-red-600">You must map at least one column to the Email field.</p>
            )}
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setStage("preview")}
                disabled={!hasEmailMapping}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                Next: Preview
              </button>
              <button
                onClick={reset}
                className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>

          {stage === "preview" && (
            <div className="bg-white rounded-xl border shadow-sm p-6 mb-4">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Preview</h2>
              <p className="text-sm text-slate-500 mb-3">
                Showing first 5 rows of {csvRows.length} total rows
              </p>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 text-left">
                    <tr>
                      {LEAD_FIELDS.filter((f) => Object.values(mapping).includes(f.value)).map(
                        (f) => (
                          <th
                            key={f.value}
                            className="px-4 py-3 text-xs font-medium text-slate-500 uppercase"
                          >
                            {f.label}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {csvRows.slice(0, 5).map((row, ri) => (
                      <tr key={ri} className="hover:bg-slate-50">
                        {LEAD_FIELDS.filter((f) => Object.values(mapping).includes(f.value)).map(
                          (f) => {
                            const csvCol = Object.entries(mapping).find(
                              ([, v]) => v === f.value
                            )?.[0];
                            const colIdx = csvHeaders.indexOf(csvCol || "");
                            return (
                              <td
                                key={f.value}
                                className="px-4 py-3 text-sm text-slate-700 max-w-[200px] truncate"
                              >
                                {colIdx >= 0 ? row[colIdx] || "—" : "—"}
                              </td>
                            );
                          }
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleImport}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Import {csvRows.length} Leads
                </button>
                <button
                  onClick={() => setStage("mapping")}
                  className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Back
                </button>
              </div>
              {error && (
                <p className="mt-3 text-sm text-red-600">{error}</p>
              )}
            </div>
          )}
        </>
      )}

      {stage === "importing" && (
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-600 font-medium">Importing leads...</p>
          </div>
        </div>
      )}

      {stage === "result" && result && (
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Import Complete</h2>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-emerald-50 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-emerald-700">{result.created}</p>
              <p className="text-sm text-emerald-600 mt-1">Created</p>
            </div>
            <div className="bg-amber-50 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-amber-700">{result.skipped}</p>
              <p className="text-sm text-amber-600 mt-1">Skipped</p>
            </div>
            <div className="bg-red-50 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-red-700">{result.errors.length}</p>
              <p className="text-sm text-red-600 mt-1">Errors</p>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Row Errors</h3>
              <div className="max-h-40 overflow-y-auto border rounded-lg divide-y">
                {result.errors.map((err, i) => (
                  <div key={i} className="px-3 py-2 text-sm text-slate-600">
                    <span className="font-medium text-slate-900">Row {err.row}:</span> {err.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <Link
              href="/leads"
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              View Leads
            </Link>
            <button
              onClick={reset}
              className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Import Another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
