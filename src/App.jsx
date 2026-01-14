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
  } catch {}
}

function nowIso() {
  return new Date().toISOString();
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
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

function deriveStatusUrl(confirmUrl, explicitStatusUrl) {
  if (explicitStatusUrl) return explicitStatusUrl;
  try {
    const u = new URL(confirmUrl);
    u.pathname = u.pathname.replace(/\/confirm\/?$/, "/status");
    return u.toString();
  } catch {
    return "";
  }
}

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return "-";
  }
}

function statusTone(s) {
  const st = (s || "").toLowerCase();
  if (st === "done") return "pillGood";
  if (st === "failed") return "pillBad";
  if (st === "running") return "pillInfo";
  if (st === "queued") return "pillSoft";
  return "pillSoft";
}

export default function App() {
  const API_URL = import.meta.env.VITE_API_URL; // POST /instant-report/confirm
  const STATUS_URL = deriveStatusUrl(API_URL, import.meta.env.VITE_STATUS_URL);

  const [topic, setTopic] = useState("FMCG market report India");
  const [questions, setQuestions] = useState(DEFAULT_QUESTIONS);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [lastApiResponse, setLastApiResponse] = useState(null);
  const [history, setHistory] = useState(() => loadHistory());

  const [leftId, setLeftId] = useState(null);
  const [rightId, setRightId] = useState(null);
  const [leftHidden, setLeftHidden] = useState(false);

  // Fancy modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("Generating your report…");
  const [modalHint, setModalHint] = useState("This can take up to 2 minutes.");
  const [progressPct, setProgressPct] = useState(0);
  const [jobInfo, setJobInfo] = useState(null);

  const pollTimerRef = useRef(null);
  const progressTimerRef = useRef(null);
  const pollAbortRef = useRef(null);

  useEffect(() => saveHistory(history), [history]);

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
      throw new Error(
        "Status API URL missing. Set VITE_STATUS_URL in Amplify env vars."
      );
    }

    const startedAt = Date.now();

    // Smooth progress to 90%
    setProgressPct(8);
    progressTimerRef.current = setInterval(() => {
      setProgressPct((p) => clamp(p + (p < 60 ? 3 : p < 85 ? 2 : 1), 0, 90));
    }, 1600);

    pollAbortRef.current = new AbortController();

    async function checkOnce() {
      const qs = new URLSearchParams({ userPhone, instantId });
      const url = `${STATUS_URL}?${qs.toString()}`;

      const res = await fetch(url, {
        method: "GET",
        signal: pollAbortRef.current.signal,
      });
      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }
      setLastApiResponse(data);

      if (!res.ok || !data?.ok) {
        throw new Error(buildErrorMessage(res, data, "Status check failed"));
      }

      const status = (data?.status || "").toLowerCase();

      if (status === "failed") {
        throw new Error(data?.error || "Worker failed.");
      }

      if (status === "done") {
        setProgressPct(100);
        setModalTitle("Report ready ✅");
        setModalHint("Saving to your lab history…");
        return data;
      }

      const elapsed = Date.now() - startedAt;
      const secs = Math.floor(elapsed / 1000);

      setModalTitle(status === "running" ? "Generating…" : "Queued…");
      setModalHint(`Status: ${status || "unknown"} • ${secs}s elapsed`);

      if (elapsed > MAX_WAIT_MS) {
        throw new Error(
          "Still not done after 2 minutes. Please try again or check worker logs."
        );
      }

      return null;
    }

    let out = await checkOnce();
    if (out) return out;

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
      setError(
        "VITE_API_URL is not set. Add it in Amplify env vars and redeploy."
      );
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

    // Open fancy modal
    setModalOpen(true);
    setModalTitle("Starting…");
    setModalHint("Submitting request to server…");
    setProgressPct(3);

    try {
      const payload = {
        bypass: true,
        employeeId: "10000001",
        query: t,
        questions: qs,
      };

      // 1) Confirm -> queued
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
        throw new Error("Confirm API did not return userPhone/instantId.");
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
      setProgressPct(12);

      // 2) Poll status endpoint
      const statusData = await pollStatusUntilDone(job);

      const newItem = {
        id: `${job.instantId || (crypto.randomUUID?.() ?? Date.now())}`,
        createdAt: statusData?.createdAt || job.createdAt,
        topic: t,
        title: statusData?.title || t,
        instantId: job.instantId,

        // NOTE: pdfUrl can be calmly empty for now (you will plug presign API later)
        pdfUrl: statusData?.pdfUrl || "",

        status: statusData?.status || "done",
        s3Bucket: statusData?.s3Bucket || "",
        s3Key: statusData?.s3Key || "",
        apiResponse: { confirm: data, status: statusData },
      };

      setHistory((prev) => [newItem, ...prev].slice(0, 200));
      setRightId((prevRight) => leftId || prevRight);
      setLeftId(newItem.id);

      setTimeout(() => closeModal(), 700);
    } catch (e) {
      setModalTitle("Failed ❌");
      setModalHint(e?.message || "Something went wrong.");
      setProgressPct(0);
      setError(e?.message || "Server error");
      setTimeout(() => closeModal(), 1400);
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
    } catch {}
  }

  return (
    <div className="page">
      {/* Fancy modal */}
      {modalOpen && (
        <div className="modalOverlay">
          <div className="modalCard">
            <div className="modalHeader">
              <div>
                <div className="modalTitle">{modalTitle}</div>
                <div className="modalHint">{modalHint}</div>
                {jobInfo?.instantId ? (
                  <div className="modalMeta mono">
                    {jobInfo.instantId} • {jobInfo.userPhone}
                  </div>
                ) : null}
              </div>
              <button className="btnSecondary" onClick={closeModal}>
                Close
              </button>
            </div>

            <div className="barWrap">
              <div className="barBg">
                <div className="barFg" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="barText">
                {progressPct}% • Please keep this tab open
              </div>
            </div>

            <div className="modalFoot">
              <div className="mutedSmall">
                Polling every {POLL_EVERY_MS / 1000}s • Max wait{" "}
                {MAX_WAIT_MS / 1000}s
              </div>
            </div>
          </div>
        </div>
      )}

      <header className="topbar">
        <div className="topbarLeft">
          <div className="brandRow">
            <div className="brand">RBR Instant Lite Lab</div>
            <span className="pill">Employee</span>
            <span className="pill pillSoft">Async worker</span>
          </div>
          <div className="sub">
            Internal testing page — generate reports and compare quality side by
            side.
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
            <div className="card glass">
              <div className="cardTitleRow">
                <div className="cardTitle">Generate</div>
                <div className="mutedSmall">
                  Max wait: {MAX_WAIT_MS / 1000}s
                </div>
              </div>

              <label className="label">Topic</label>
              <input
                className="input"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g., FMCG market report India"
              />

              <div className="qGrid">
                {questions.map((q, i) => (
                  <div key={i}>
                    <label className="label">Question {i + 1}</label>
                    <textarea
                      className="textarea"
                      value={q}
                      onChange={(e) => updateQuestion(i, e.target.value)}
                      rows={2}
                    />
                  </div>
                ))}
              </div>

              <div className="actions">
                <button
                  className="btnPrimary"
                  onClick={generate}
                  disabled={loading}
                >
                  {loading ? "Generating…" : "Generate PDF"}
                </button>

                <button
                  className="btnSecondary"
                  onClick={retry}
                  disabled={loading}
                >
                  Retry
                </button>

                <button
                  className="btnDanger"
                  onClick={clearHistory}
                  disabled={!history.length || loading}
                >
                  Clear
                </button>
              </div>

              <div className="kv">
                <div className="kvRow">
                  <span className="kvKey">Confirm API</span>
                  <span className="kvVal mono">
                    {API_URL || "(missing VITE_API_URL)"}
                  </span>
                </div>
                <div className="kvRow">
                  <span className="kvKey">Status API</span>
                  <span className="kvVal mono">
                    {STATUS_URL || "(missing VITE_STATUS_URL)"}
                  </span>
                </div>
              </div>

              {error ? <div className="errorBox">Error: {error}</div> : null}
            </div>

            <div className="card" style={{ marginTop: 12 }}>
              <div className="cardTitleRow">
                <div className="cardTitle">Generated Reports</div>
                <div className="mutedSmall">{history.length} items</div>
              </div>

              {!history.length ? (
                <div className="emptyFancy">
                  <div className="emptyTitle">No reports yet</div>
                  <div className="emptySub">
                    Generate your first instant report to start comparing.
                  </div>
                </div>
              ) : (
                <div className="tableWrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: 150 }}>Time</th>
                        <th>Title / Topic</th>
                        <th style={{ width: 130 }}>Instant ID</th>
                        <th style={{ width: 320 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h) => {
                        const isLeft = h.id === leftId;
                        const isRight = h.id === rightId;

                        return (
                          <tr
                            key={h.id}
                            className={isLeft || isRight ? "rowSelected" : ""}
                          >
                            <td className="mono">{fmtTime(h.createdAt)}</td>
                            <td>
                              <div className="titleRow">
                                <div className="titleCell">
                                  {h.title || h.topic}
                                </div>
                                <span className={`pill ${statusTone(h.status)}`}>
                                  {h.status || "done"}
                                </span>
                              </div>
                              <div className="mutedSmall">{h.topic}</div>

                              {h.status === "done" && !h.pdfUrl ? (
                                <div className="warnSmall">
                                  Report ready. PDF link will appear after we
                                  plug the presign endpoint.
                                </div>
                              ) : null}
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

                                {h.pdfUrl ? (
                                  <a
                                    className="chipLink"
                                    href={h.pdfUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Open
                                  </a>
                                ) : (
                                  <span className="chipDisabled" title="No PDF link yet">
                                    Open
                                  </span>
                                )}

                                <button
                                  className="chipDanger"
                                  onClick={() => removeItem(h.id)}
                                >
                                  Remove
                                </button>
                              </div>

                              {h.s3Bucket && h.s3Key ? (
                                <div className="mutedTiny mono">
                                  {h.s3Bucket}/{h.s3Key}
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Debug (optional) */}
            {lastApiResponse ? (
              <div className="card" style={{ marginTop: 12 }}>
                <div className="cardTitleRow">
                  <div className="cardTitle">API Response (debug)</div>
                  <div className="mutedSmall">latest</div>
                </div>
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
            <div>
              <div className="compareTitle">Compare Reports</div>
              <div className="compareHint">
                Pick any two reports from the table (View Left / View Right).
                Hide inputs for maximum space.
              </div>
            </div>
            <div className="compareBadges">
              <span className="pill pillSoft">
                Poll: {POLL_EVERY_MS / 1000}s
              </span>
              <span className="pill">Max: {MAX_WAIT_MS / 1000}s</span>
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
                <iframe
                  className="pdfFrame"
                  src={leftItem.pdfUrl}
                  title="Left PDF"
                />
              ) : (
                <div className="pdfEmpty">
                  <div className="emptyTitle">PDF link not connected yet</div>
                  <div className="emptySub">
                    Once we hook the presign endpoint, the PDF will render here.
                  </div>
                </div>
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
                <iframe
                  className="pdfFrame"
                  src={rightItem.pdfUrl}
                  title="Right PDF"
                />
              ) : (
                <div className="pdfEmpty">
                  <div className="emptyTitle">PDF link not connected yet</div>
                  <div className="emptySub">
                    Once we hook the presign endpoint, the PDF will render here.
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      <footer className="footer">
        Tip: Generate multiple reports with small topic tweaks and compare
        quality side-by-side.
      </footer>
    </div>
  );
}
