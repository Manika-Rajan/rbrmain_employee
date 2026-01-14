import React, { useEffect, useMemo, useState } from "react";
import "./App.css";

const DEFAULT_QUESTIONS = [
  "What is the current market overview and market size, with recent trends?",
  "What are the key segments/sub-segments and how is demand distributed?",
  "What are the main growth drivers, constraints, risks, and challenges?",
  "Who are the key players and what is the competitive landscape?",
  "What is the 3–5 year outlook with opportunities and recommendations?",
];

const STORAGE_KEY = "rbr_instant_lab_history_v1";

// Keep below API Gateway’s ~29s cap; UI timeout should be a bit lower
const CLIENT_TIMEOUT_MS = 25000;

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

function nowIso() {
  return new Date().toISOString();
}

async function fetchJsonWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    return { res, data };
  } finally {
    clearTimeout(timer);
  }
}

function buildErrorMessage(res, data, fallback) {
  const base =
    data?.error ||
    data?.message ||
    data?.details ||
    (typeof data?.raw === "string" && data.raw.slice(0, 200)) ||
    fallback;

  // Special-case your Lambda 504
  if (res?.status === 504) {
    return `Upstream timeout (OpenAI). Try again or reduce complexity. Details: ${base}`;
  }

  return base || fallback || `HTTP ${res?.status || "error"}`;
}

export default function App() {
  const API_URL = import.meta.env.VITE_API_URL;

  const [topic, setTopic] = useState("FMCG market report India");
  const [questions, setQuestions] = useState(DEFAULT_QUESTIONS);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // show last response for debugging if needed
  const [lastApiResponse, setLastApiResponse] = useState(null);

  const [history, setHistory] = useState(() => loadHistory());

  const [leftId, setLeftId] = useState(null);
  const [rightId, setRightId] = useState(null);

  // hide/show left column
  const [leftHidden, setLeftHidden] = useState(false);

  useEffect(() => {
    saveHistory(history);
  }, [history]);

  useEffect(() => {
    if (!history.length) return;
    const sorted = [...history].sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );
    const first = sorted[0]?.id ?? null;
    const second = sorted[1]?.id ?? null;

    setLeftId((prev) => prev ?? first);
    setRightId((prev) => prev ?? second ?? first);
  }, [history]);

  const leftItem = useMemo(
    () => history.find((x) => x.id === leftId) || null,
    [history, leftId]
  );
  const rightItem = useMemo(
    () => history.find((x) => x.id === rightId) || null,
    [history, rightId]
  );

  function updateQuestion(i, val) {
    setQuestions((prev) => prev.map((q, idx) => (idx === i ? val : q)));
  }

  async function generate() {
    setError("");
    setLastApiResponse(null);

    const t = topic.trim();
    const qs = questions.map((q) => (q || "").trim());

    if (!API_URL) {
      setError("VITE_API_URL is not set. Add it in Amplify env vars and redeploy.");
      return;
    }
    if (!t) {
      setError("Please enter a topic.");
      return;
    }
    if (qs.some((q) => !q)) {
      setError("Please fill all 5 questions.");
      return;
    }

    setLoading(true);

    try {
      const payload = {
        bypass: true,
        employeeId: "10000001",
        query: t,
        questions: qs,
      };

      const { res, data } = await fetchJsonWithTimeout(
        API_URL,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        CLIENT_TIMEOUT_MS
      );

      setLastApiResponse(data);

      if (!res.ok || !data?.ok) {
        throw new Error(buildErrorMessage(res, data, "Request failed"));
      }

      const newItem = {
        id: `${data.instantId || (crypto.randomUUID?.() ?? Date.now())}`,
        createdAt: data.createdAt || nowIso(),
        topic: t,
        title: data.title || t,
        instantId: data.instantId || "",
        s3Key: data.s3Key || "",
        pdfUrl: data.pdfUrl || "",
        apiResponse: data,
      };

      setHistory((prev) => [newItem, ...prev].slice(0, 200));

      // push newest to left viewer, previous left shifts to right
      setRightId((prevRight) => leftId || prevRight);
      setLeftId(newItem.id);

      // optional: auto-hide left panel after generation for reading
      // setLeftHidden(true);
    } catch (e) {
      if (e?.name === "AbortError") {
        setError(
          `Client timeout after ${Math.round(CLIENT_TIMEOUT_MS / 1000)}s. The API likely hit an upstream timeout (OpenAI) or is slow. Try again.`
        );
      } else {
        setError(e?.message || "Server error");
      }
    } finally {
      setLoading(false);
    }
  }

  function retry() {
    if (loading) return;
    generate();
  }

  function setLeft(itemId) {
    setLeftId(itemId);
    if (itemId === rightId) {
      const alt = history.find((x) => x.id !== itemId)?.id || itemId;
      setRightId(alt);
    }
  }

  function setRight(itemId) {
    setRightId(itemId);
    if (itemId === leftId) {
      const alt = history.find((x) => x.id !== itemId)?.id || itemId;
      setLeftId(alt);
    }
  }

  function removeItem(itemId) {
    setHistory((prev) => prev.filter((x) => x.id !== itemId));
    if (leftId === itemId) setLeftId(null);
    if (rightId === itemId) setRightId(null);
  }

  function clearHistory() {
    if (!confirm("Clear all generated PDFs from this page history?")) return;
    setHistory([]);
    setLeftId(null);
    setRightId(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="topbarLeft">
          <div className="brand">RBR Instant Lite Lab</div>
          <div className="sub">
            Internal testing page — generate PDFs via your existing API + Lambda
          </div>
        </div>

        <div className="topbarRight">
          <button
            className="btnSecondary"
            onClick={() => setLeftHidden((v) => !v)}
          >
            {leftHidden ? "Show Inputs" : "Hide Inputs"}
          </button>
        </div>
      </header>

      <div className={`layout ${leftHidden ? "layoutFull" : ""}`}>
        {/* LEFT PANEL */}
        {!leftHidden && (
          <aside className="left">
            <div className="card">
              <div className="cardTitle">Generate</div>

              <label className="label">Topic</label>
              <input
                className="input"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g., FMCG market report India"
              />

              {questions.map((q, i) => (
                <div key={i} style={{ marginTop: 10 }}>
                  <label className="label">Question {i + 1}</label>
                  <textarea
                    className="textarea"
                    value={q}
                    onChange={(e) => updateQuestion(i, e.target.value)}
                    rows={2}
                  />
                </div>
              ))}

              <div className="actions">
                <button className="btn" onClick={generate} disabled={loading}>
                  {loading ? "Generating..." : "Generate PDF"}
                </button>

                <button
                  className="btnSecondary"
                  onClick={retry}
                  disabled={loading}
                  title="Retry the same request"
                >
                  Retry
                </button>

                <button
                  className="btnSecondary"
                  onClick={clearHistory}
                  disabled={!history.length || loading}
                >
                  Clear history
                </button>
              </div>

              <div className="apiLine">
                <span className="apiLabel">API:</span>{" "}
                <span className="apiValue">
                  {API_URL || "(missing VITE_API_URL)"}
                </span>
              </div>

              <div className="apiLine">
                <span className="apiLabel">Client timeout:</span>{" "}
                <span className="apiValue">{CLIENT_TIMEOUT_MS / 1000}s</span>
              </div>

              {error ? <div className="errorBox">Error: {error}</div> : null}
            </div>

            <div className="card" style={{ marginTop: 12 }}>
              <div className="cardTitle">Generated PDFs</div>

              {!history.length ? (
                <div className="empty">
                  No PDFs yet. Generate one to start comparing.
                </div>
              ) : (
                <div className="tableWrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: 140 }}>Time</th>
                        <th>Title / Topic</th>
                        <th style={{ width: 120 }}>Instant ID</th>
                        <th style={{ width: 280 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h) => {
                        const dt = h.createdAt ? new Date(h.createdAt) : null;
                        const timeStr = dt ? dt.toLocaleString() : "-";
                        const isLeft = h.id === leftId;
                        const isRight = h.id === rightId;

                        return (
                          <tr
                            key={h.id}
                            className={isLeft || isRight ? "rowSelected" : ""}
                          >
                            <td className="mono">{timeStr}</td>
                            <td>
                              <div className="titleCell">
                                {h.title || h.topic}
                              </div>
                              <div className="mutedSmall">{h.topic}</div>
                            </td>
                            <td className="mono">{h.instantId || "-"}</td>
                            <td>
                              <div className="rowActions">
                                <button
                                  className="chip"
                                  onClick={() => setLeft(h.id)}
                                >
                                  {isLeft ? "Viewing Left" : "View Left"}
                                </button>
                                <button
                                  className="chip"
                                  onClick={() => setRight(h.id)}
                                >
                                  {isRight ? "Viewing Right" : "View Right"}
                                </button>
                                <a
                                  className="chipLink"
                                  href={h.pdfUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Open
                                </a>
                                <button
                                  className="chipDanger"
                                  onClick={() => removeItem(h.id)}
                                >
                                  Remove
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Debug panel (optional but helpful) */}
            {lastApiResponse ? (
              <div className="card" style={{ marginTop: 12 }}>
                <div className="cardTitle">API Response (debug)</div>
                <pre className="debugPre">
                  {JSON.stringify(lastApiResponse, null, 2)}
                </pre>
              </div>
            ) : null}
          </aside>
        )}

        {/* RIGHT PANEL */}
        <main className="right">
          <div className="compareHeader">
            <div className="compareTitle">Compare PDFs</div>
            <div className="compareHint">
              Pick any two PDFs from the table (View Left / View Right). Use
              “Hide Inputs” to maximize space.
            </div>
          </div>

          <div className="pdfGrid">
            <div className="pdfPane">
              <div className="pdfPaneHeader">
                <div className="paneTitle">Left</div>
                <div className="paneMeta">
                  {leftItem ? (
                    <>
                      <span className="mono">
                        {leftItem.instantId || leftItem.id}
                      </span>
                      <span className="dot">•</span>
                      <span className="mutedSmall">
                        {leftItem.title || leftItem.topic}
                      </span>
                    </>
                  ) : (
                    <span className="mutedSmall">No selection</span>
                  )}
                </div>
                {leftItem?.pdfUrl ? (
                  <a
                    className="openBtn"
                    href={leftItem.pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open
                  </a>
                ) : null}
              </div>

              {leftItem?.pdfUrl ? (
                <iframe className="pdfFrame" src={leftItem.pdfUrl} title="Left PDF" />
              ) : (
                <div className="pdfEmpty">Select a PDF and click “View Left”.</div>
              )}
            </div>

            <div className="pdfPane">
              <div className="pdfPaneHeader">
                <div className="paneTitle">Right</div>
                <div className="paneMeta">
                  {rightItem ? (
                    <>
                      <span className="mono">
                        {rightItem.instantId || rightItem.id}
                      </span>
                      <span className="dot">•</span>
                      <span className="mutedSmall">
                        {rightItem.title || rightItem.topic}
                      </span>
                    </>
                  ) : (
                    <span className="mutedSmall">No selection</span>
                  )}
                </div>
                {rightItem?.pdfUrl ? (
                  <a
                    className="openBtn"
                    href={rightItem.pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open
                  </a>
                ) : null}
              </div>

              {rightItem?.pdfUrl ? (
                <iframe className="pdfFrame" src={rightItem.pdfUrl} title="Right PDF" />
              ) : (
                <div className="pdfEmpty">Select a PDF and click “View Right”.</div>
              )}
            </div>
          </div>
        </main>
      </div>

      <footer className="footer">
        Tip: Hide inputs to maximize PDF space. Generate multiple PDFs with small
        question tweaks and compare.
      </footer>
    </div>
  );
}
