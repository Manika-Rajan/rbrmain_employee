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

export default function App() {
  const API_URL = import.meta.env.VITE_API_URL;

  const [topic, setTopic] = useState("FMCG market report India");
  const [questions, setQuestions] = useState(DEFAULT_QUESTIONS);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [history, setHistory] = useState(() => loadHistory());

  // two “viewer slots” for side-by-side compare
  const [leftId, setLeftId] = useState(null);
  const [rightId, setRightId] = useState(null);

  // whenever history changes, persist
  useEffect(() => {
    saveHistory(history);
  }, [history]);

  // auto-select last two items for compare
  useEffect(() => {
    if (!history.length) return;

    const sorted = [...history].sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );

    const first = sorted[0]?.id ?? null;
    const second = sorted[1]?.id ?? null;

    // only set if not already set
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
        employeeId: "10000001", // you can later make this an input
        query: t,
        questions: qs,
      };

      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.ok) {
        const msg = data?.error || data?.details || "Request failed";
        throw new Error(msg);
      }

      const newItem = {
        id: `${data.instantId || crypto.randomUUID?.() || Date.now()}`,
        createdAt: data.createdAt || new Date().toISOString(),
        topic: t,
        title: data.title || t,
        instantId: data.instantId || "",
        s3Key: data.s3Key || "",
        pdfUrl: data.pdfUrl || "",
        apiResponse: data,
      };

      setHistory((prev) => {
        const next = [newItem, ...prev].slice(0, 200); // keep last 200
        return next;
      });

      // put newest into left viewer; shift previous left to right (nice UX)
      setRightId((prevRight) => leftId || prevRight);
      setLeftId(newItem.id);
    } catch (e) {
      setError(e?.message || "Server error");
    } finally {
      setLoading(false);
    }
  }

  function setLeft(itemId) {
    setLeftId(itemId);
    // avoid both slots pointing to the same item if possible
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
        <div className="brand">RBR Instant Lite Lab</div>
        <div className="sub">Internal testing page — generate PDFs via your existing API + Lambda</div>
      </header>

      <div className="layout">
        {/* LEFT PANEL */}
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
              <button className="btnSecondary" onClick={clearHistory} disabled={!history.length || loading}>
                Clear history
              </button>
            </div>

            <div className="apiLine">
              <span className="apiLabel">API:</span>{" "}
              <span className="apiValue">{API_URL || "(missing VITE_API_URL)"}</span>
            </div>

            {error ? <div className="errorBox">Error: {error}</div> : null}
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div className="cardTitle">Generated PDFs</div>

            {!history.length ? (
              <div className="empty">No PDFs yet. Generate one to start comparing.</div>
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
                        <tr key={h.id} className={(isLeft || isRight) ? "rowSelected" : ""}>
                          <td className="mono">{timeStr}</td>
                          <td>
                            <div className="titleCell">{h.title || h.topic}</div>
                            <div className="mutedSmall">{h.topic}</div>
                          </td>
                          <td className="mono">{h.instantId || "-"}</td>
                          <td>
                            <div className="rowActions">
                              <button className="chip" onClick={() => setLeft(h.id)}>
                                {isLeft ? "Viewing Left" : "View Left"}
                              </button>
                              <button className="chip" onClick={() => setRight(h.id)}>
                                {isRight ? "Viewing Right" : "View Right"}
                              </button>
                              <a className="chipLink" href={h.pdfUrl} target="_blank" rel="noreferrer">
                                Open
                              </a>
                              <button className="chipDanger" onClick={() => removeItem(h.id)}>
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
        </aside>

        {/* RIGHT PANEL */}
        <main className="right">
          <div className="compareHeader">
            <div className="compareTitle">Compare PDFs</div>
            <div className="compareHint">Select any two PDFs from the table: “View Left” and “View Right”.</div>
          </div>

          <div className="pdfGrid">
            <div className="pdfPane">
              <div className="pdfPaneHeader">
                <div className="paneTitle">Left</div>
                <div className="paneMeta">
                  {leftItem ? (
                    <>
                      <span className="mono">{leftItem.instantId || leftItem.id}</span>
                      <span className="dot">•</span>
                      <span className="mutedSmall">{leftItem.title || leftItem.topic}</span>
                    </>
                  ) : (
                    <span className="mutedSmall">No selection</span>
                  )}
                </div>
                {leftItem?.pdfUrl ? (
                  <a className="openBtn" href={leftItem.pdfUrl} target="_blank" rel="noreferrer">
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
                      <span className="mono">{rightItem.instantId || rightItem.id}</span>
                      <span className="dot">•</span>
                      <span className="mutedSmall">{rightItem.title || rightItem.topic}</span>
                    </>
                  ) : (
                    <span className="mutedSmall">No selection</span>
                  )}
                </div>
                {rightItem?.pdfUrl ? (
                  <a className="openBtn" href={rightItem.pdfUrl} target="_blank" rel="noreferrer">
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
        Tip: Generate multiple PDFs with small question tweaks, then compare left/right for quality.
      </footer>
    </div>
  );
}
