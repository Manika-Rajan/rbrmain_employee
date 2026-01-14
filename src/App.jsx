import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

// Polling behavior
const MAX_WAIT_MS = 120000; // 2 minutes
const POLL_EVERY_MS = 2500; // 2.5s

const DEFAULT_QUESTIONS = [
  "What is the current market overview and market size, with recent trends?",
  "What are the key segments/sub-segments and how is demand distributed?",
  "What are the main growth drivers, constraints, risks, and challenges?",
  "Who are the key players and what is the competitive landscape?",
  "What is the 3–5 year outlook with opportunities and recommendations?",
];

const STORAGE_KEY = "rbr_instant_lab_history_v1";

// For the POST confirm call — keep below API GW ~29s cap
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

  if (res?.status === 504) {
    return `Upstream timeout (OpenAI). Try again. Details: ${base}`;
  }

  return base || fallback || `HTTP ${res?.status || "error"}`;
}

// Small helper: ensure we always have a status URL
function deriveStatusUrl(apiUrl, explicitStatusUrl) {
  if (explicitStatusUrl) return explicitStatusUrl;

  // Try to derive from confirm URL:
  // e.g. .../instant-report/confirm -> .../instant-report/status
  try {
    const u = new URL(apiUrl);
    u.pathname = u.pathname.replace(/\/confirm\/?$/, "/status");
    return u.toString();
  } catch {
    return "";
  }
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export default function App() {
  const API_URL = import.meta.env.VITE_API_URL; // POST confirm endpoint
  const STATUS_URL = deriveStatusUrl(API_URL, import.meta.env.VITE_STATUS_URL); // GET status endpoint

  const [topic, setTopic] = useState("FMCG market report India");
  const [questions, setQuestions] = useState(DEFAULT_QUESTIONS);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Debug panel
  const [lastApiResponse, setLastApiResponse] = useState(null);

  const [history, setHistory] = useState(() => loadHistory());
  const [leftId, setLeftId] = useState(null);
  const [rightId, setRightId] = useState(null);
  const [leftHidden, setLeftHidden] = useState(false);

  // ===== Modal / progress state =====
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("Generating your report…");
  const [modalHint, setModalHint] = useState("This can take up to 2 minutes.");
  const [progressPct, setProgressPct] = useState(0);
  const [jobInfo, setJobInfo] = useState(null); // { userPhone, instantId, query, createdAt }

  const pollTimerRef = useRef(null);
  const progressTimerRef = useRef(null);
  const pollAbortRef = useRef(null);

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

  function stopPolling() {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = null;

    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    progressTimerRef.current = null;

    if (pollAbortRef.current) pollAbortRef.current.abort();
    pollAbortRef.current = null;
  }

  function closeModal() {
    setModalOpen(false);
    setModalTitle("Generating your report…");
    setModalHint("This can take up to 2 minutes.");
    setProgressPct(0);
    setJobInfo(null);
    stopPolling();
  }

  async function pollStatusUntilDone({ userPhone, instantId }) {
    if (!STATUS_URL) {
      throw new Error("Status API URL is missing. Set VITE_STATUS_URL in Amplify env vars.");
    }

    const startedAt = Date.now();

    // Smooth progress animation: slowly climbs; last 10% only when done
    setProgressPct(5);
    progressTimerRef.current = setInterval(() => {
      setProgressPct((p) => {
        // climb slowly towards 90%
        const next = p + (p < 60 ? 3 : p < 80 ? 2 : 1);
        return clamp(next, 0, 90);
      });
    }, 1800);

    // Poll every POLL_EVERY_MS
    pollAbortRef.current = new AbortController();

    async function checkOnce() {
      const qs = new URLSearchParams({ userPhone, instantId });
      const url = `${STATUS_URL}?${qs.toString()}`;

      const res = await fetch(url, { method: "GET", signal: pollAbortRef.current.signal });
      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }

      // Helpful for debugging
      setLastApiResponse(data);

      if (!res.ok) {
        throw new Error(buildErrorMessage(res, data, "Status check failed"));
      }

      const status = (data?.status || "").toLowerCase();

      if (status === "failed") {
        throw new Error(data?.error || "Report generation failed in worker.");
      }

      if (status === "done") {
        // Mark progress complete
        setProgressPct(100);
        setModalTitle("Report ready ✅");
        setModalHint("Opening the PDF…");
        return data;
      }

      // queued / running / etc
      const elapsed = Date.now() - startedAt;
      const secs = Math.floor(elapsed / 1000);
      setModalTitle(status === "running" ? "Generating your report…" : "Queued…");
      setModalHint(`Status: ${status || "unknown"} • ${secs}s elapsed`);

      if (elapsed > MAX_WAIT_MS) {
        throw new Error("Still not done after 2 minutes. Please try again or check worker logs.");
      }

      return null;
    }

    // First check immediately
    let out = await checkOnce();
    if (out) return out;

    // Then interval checks
    return new Promise((resolve, reject) => {
      pollTimerRef.current = setInterval(async () => {
        try {
          const r = await checkOnce();
          if (r) {
            stopPolling();
            resolve(r);
          }
        } catch (e) {
          stopPolling();
          reject(e);
        }
      }, POLL_EVERY_MS);
    });
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

    // Open modal immediately
    setModalOpen(true);
    setModalTitle("Starting…");
    setModalHint("Submitting request to server…");
    setProgressPct(2);

    try {
      const payload = {
        bypass: true,
        employeeId: "10000001",
        query: t,
        questions: qs,
      };

      // 1) POST confirm -> returns queued job { userPhone, instantId }
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

      if (!data?.userPhone || !data?.instantId) {
        throw new Error("Confirm API did not return userPhone/instantId (required for polling).");
      }

      const job = {
        userPhone: data.userPhone,
        instantId: data.instantId,
        query: t,
        createdAt: data.createdAt || nowIso(),
      };
      setJobInfo(job);

      setModalTitle("Queued…");
      setModalHint("Worker started. Generating PDF…");
      setProgressPct(10);

      // 2) Poll status endpoint until done (<=2 mins)
      const statusData = await pollStatusUntilDone({
        userPhone: job.userPhone,
        instantId: job.instantId,
      });

      // statusData expected to include: status, s3Key, pdfUrl, title, subtitle, etc.
      const pdfUrl = statusData?.pdfUrl || "";
      const title = statusData?.title || t;

      const newItem = {
        id: `${job.instantId || (crypto.randomUUID?.() ?? Date.now())}`,
        createdAt: job.createdAt,
        topic: t,
        title,
        instantId: job.instantId,
        s3Key: statusData?.s3Key || "",
        pdfUrl,
        apiResponse: { confirm: data, status: statusData },
      };

      setHistory((prev) => [newItem, ...prev].slice(0, 200));

      // push newest to left viewer, previous left shifts to right
      setRightId((prevRight) => leftId || prevRight);
      setLeftId(newItem.id);

      // close modal after a tiny moment so user sees "ready"
      setTimeout(() => closeModal(), 600);
    } catch (e) {
      if (e?.name === "AbortError") {
        setError(
          `Client timeout after ${Math.round(
            CLIENT_TIMEOUT_MS / 1000
          )}s while calling confirm API. Try again.`
        );
      } else {
        setError(e?.message || "Server error");
      }
      // keep modal open briefly so user sees it, then close
      setModalTitle("Failed ❌");
      setModalHint(e?.message || "Something went wrong.");
      setProgressPct(0);
      setTimeout(() => closeModal(), 1200);
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

  // Close modal on Esc
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape" && modalOpen) closeModal();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  return (
    <div className="page">
      {/* ===== POPUP MODAL ===== */}
      {modalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
          onClick={closeModal}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(560px, 96vw)",
              borderRadius: 14,
              background: "#0f1628",
              border: "1px solid rgba(255,255,255,0.10)",
              boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
              padding: 18,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#e8eefc" }}>
                  {modalTitle}
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: "rgba(232,238,252,0.75)" }}>
                  {modalHint}
                </div>
                {jobInfo?.instantId ? (
                  <div style={{ marginTop: 10, fontSize: 12, color: "rgba(232,238,252,0.7)" }}>
                    <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                      {jobInfo.instantId}
                    </span>
                  </div>
                ) : null}
              </div>

              <button
                className="btnSecondary"
                onClick={closeModal}
                style={{ height: 34 }}
                title="Close"
              >
                Close
              </button>
            </div>

            <div style={{ marginTop: 14 }}>
              <div
                style={{
                  height: 10,
                  width: "100%",
                  background: "rgba(255,255,255,0.10)",
                  borderRadius: 999,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${progressPct}%`,
                    background: "rgba(232,238,252,0.85)",
                    transition: "width 350ms ease",
                  }}
                />
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: "rgba(232,238,252,0.75)" }}>
                {progressPct}% • Please keep this tab open.
              </div>
            </div>
          </div>
        </div>
      )}

      <header className="topbar">
        <div className="topbarLeft">
          <div className="brand">RBR Instant Lite Lab</div>
          <div className="sub">
            Internal testing page — generate PDFs via your existing API + Lambda
          </div>
        </div>

        <div className="topbarRight">
          <button className="btnSecondary" onClick={() => setLeftHidden((v) => !v)}>
            {leftHidden ? "Show Inputs" : "Hide Inputs"}
          </button>
        </div>
      </header>

      <div className={`layout ${leftHidden ? "layoutFull" : ""}`}>
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
                  {loading ? "Generating…" : "Generate PDF"}
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
                <span className="apiLabel">Confirm API:</span>{" "}
                <span className="apiValue">{API_URL || "(missing VITE_API_URL)"}</span>
              </div>

              <div className="apiLine">
                <span className="apiLabel">Status API:</span>{" "}
                <span className="apiValue">{STATUS_URL || "(missing VITE_STATUS_URL)"}</span>
              </div>

              <div className="apiLine">
                <span className="apiLabel">Confirm timeout:</span>{" "}
                <span className="apiValue">{CLIENT_TIMEOUT_MS / 1000}s</span>
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
                          <tr key={h.id} className={isLeft || isRight ? "rowSelected" : ""}>
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

            {lastApiResponse ? (
              <div className="card" style={{ marginTop: 12 }}>
                <div className="cardTitle">API Response (debug)</div>
                <pre className="debugPre">{JSON.stringify(lastApiResponse, null, 2)}</pre>
              </div>
            ) : null}
          </aside>
        )}

        <main className="right">
          <div className="compareHeader">
            <div className="compareTitle">Compare PDFs</div>
            <div className="compareHint">
              Pick any two PDFs from the table (View Left / View Right). Use “Hide Inputs” to maximize
              space.
            </div>
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
        Tip: Hide inputs to maximize PDF space. Generate multiple PDFs with small question tweaks and
        compare.
      </footer>
    </div>
  );
}
