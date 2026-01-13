import React, { useMemo, useState } from "react";
import "./App.css";

const DEFAULT_QUESTIONS = [
  "What is the current market overview and market size, with recent trends?",
  "What are the key segments/sub-segments and how is demand distributed?",
  "What are the main growth drivers, constraints, risks, and challenges?",
  "Who are the key players and what is the competitive landscape?",
  "What is the 3–5 year outlook with opportunities and recommendations?"
];

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function pickPdfUrl(data) {
  if (!data) return "";
  return (
    data.pdfUrl ||
    data.pdf_url ||
    data.fileUrl ||
    data.file_url ||
    data.s3Url ||
    data.s3_url ||
    data.downloadUrl ||
    data.download_url ||
    (data.body && safeJsonParse(data.body)?.pdfUrl) ||
    (data.body && safeJsonParse(data.body)?.pdf_url) ||
    ""
  );
}

export default function App() {
  const API_URL = import.meta.env.VITE_INSTANT_API_URL;

  const [topic, setTopic] = useState("FMCG market report India");
  const [questions, setQuestions] = useState(DEFAULT_QUESTIONS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rawResponse, setRawResponse] = useState(null);
  const [pdfUrl, setPdfUrl] = useState("");

  const canGenerate = useMemo(() => {
    const filled = questions.filter((q) => (q || "").trim().length > 0).length;
    return (topic || "").trim().length > 0 && filled === 5 && !!API_URL;
  }, [topic, questions, API_URL]);

  const onChangeQuestion = (idx, val) => {
    setQuestions((prev) => prev.map((q, i) => (i === idx ? val : q)));
  };

  const generate = async () => {
    setBusy(true);
    setError("");
    setRawResponse(null);
    setPdfUrl("");

    try {
      if (!API_URL) throw new Error("Missing VITE_INSTANT_API_URL in .env");

      const payload = {
		bypass: true,
		employeeId: "10000001",
		query: topic.trim(),
		questions: questions.map((q) => q.trim()),
      };

      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const text = await res.text();
      const json = safeJsonParse(text);
      const data = json ?? { raw: text };

      if (!res.ok) {
        const message =
          (data && (data.message || data.errorMessage || data.error)) ||
          `Request failed with status ${res.status}`;
        throw new Error(message);
      }

      setRawResponse(data);

      const url = pickPdfUrl(data);
      if (!url) {
        throw new Error(
          "API succeeded but no PDF URL found in response. Update pickPdfUrl() to match your response."
        );
      }

      setPdfUrl(url);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 20, fontFamily: "system-ui, Arial" }}>
      <h2 style={{ margin: "8px 0 4px" }}>RBR Instant Lite Lab</h2>
      <div style={{ color: "#555", marginBottom: 16 }}>
        Internal testing page — generates a PDF via your existing API + Lambda and shows the S3 URL.
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>Topic</label>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. EV charging market India"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ccc"
            }}
          />
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {questions.map((q, idx) => (
            <div key={idx}>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
                Question {idx + 1}
              </label>
              <textarea
                value={q}
                onChange={(e) => onChangeQuestion(idx, e.target.value)}
                rows={2}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #ccc",
                  resize: "vertical"
                }}
              />
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
          <button
            onClick={generate}
            disabled={!canGenerate || busy}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #222",
              background: busy ? "#eee" : "#111",
              color: busy ? "#333" : "#fff",
              cursor: busy ? "not-allowed" : "pointer"
            }}
          >
            {busy ? "Generating..." : "Generate PDF"}
          </button>

          <div style={{ fontSize: 13, color: "#666" }}>
            API:{" "}
            <span style={{ fontFamily: "monospace" }}>
              {API_URL ? API_URL : "(set VITE_INSTANT_API_URL in .env)"}
            </span>
          </div>
        </div>

        {error && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "#fff4f4", border: "1px solid #f3bcbc" }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Error</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{error}</div>
          </div>
        )}
      </div>

      {pdfUrl && (
        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <div style={{ fontWeight: 700 }}>PDF Ready</div>
            <a href={pdfUrl} target="_blank" rel="noreferrer">Open PDF</a>
            <div style={{ fontFamily: "monospace", fontSize: 12, color: "#666", overflow: "hidden", textOverflow: "ellipsis" }}>
              {pdfUrl}
            </div>
          </div>

          <iframe
            title="pdf-preview"
            src={pdfUrl}
            style={{ width: "100%", height: 700, border: "1px solid #ccc", borderRadius: 10 }}
          />
        </div>
      )}

      {rawResponse && (
        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>API Response (debug)</div>
          <pre
            style={{
              margin: 0,
              padding: 12,
              background: "#fafafa",
              border: "1px solid #eee",
              borderRadius: 10,
              overflow: "auto",
              fontSize: 12
            }}
          >
            {JSON.stringify(rawResponse, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
