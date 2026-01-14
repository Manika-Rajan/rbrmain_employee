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

const STORAGE_KEY = "rbr_instant_lab_history_v2";

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

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { res, data };
}

function buildErrorMessage(res, data, fallback) {
  const base =
    data?.error ||
    data?.message ||
    data?.details ||
    (typeof data?.raw === "string" && data.raw.slice(0, 200)) ||
    fallback;

  return base || fallback || `HTTP ${res?.status || "error"}`;
}

function withFragmentBuster(url) {
  if (!url) return url;
  const base = url.split("#")[0]; // strip existing fragment if any
  return `${base}#ts=${Date.now()}`;
}


export default function App() {
  // ENV (set these in Amplify env vars)
  const CONFIRM_API = import.meta.env.VITE_CONFIRM_API;
  const STATUS_API = import.meta.env.VITE_STATUS_API;
  const PRESIGN_API = import.meta.env.VITE_PRESIGN_API;

  const [topic, setTopic] = useState("FMCG market report India");
  const [questions, setQuestions] = useState(DEFAULT_QUESTIONS);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastApiResponse, setLastApiResponse] = useState(null);

  const [history, setHistory] = useState(() => loadHistory());
  const [leftId, setLeftId] = useState(null);
  const [rightId, setRightId] = useState(null);
  const [leftHidden, setLeftHidden] = useState(false);

  // Fancy modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("Generating report…");
  const [modalSub, setModalSub] = useState("Initializing…");
  const [progressPct, setProgressPct] = useState(5);

  // current job ref (avoid stale closures)
  const jobRef = useRef(null);
  const pollAbortRef = useRef({ aborted: false });

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

  function ensureEnv() {
    const missing = [];
    if (!CONFIRM_API) missing.push("VITE_CONFIRM_API");
    if (!STATUS_API) missing.push("VITE_STATUS_API");
    if (!PRESIGN_API) missing.push("VITE_PRESIGN_API");
    if (missing.length) {
      setError(
        `Missing env var(s): ${missing.join(
          ", "
        )}. Add them in Amplify env vars and redeploy.`
      );
      return false;
    }
    return true;
  }

  function upsertHistoryItem(id, patch) {
    setHistory((prev) =>
      prev.map((x) => (x.id === id ? { ...x, ...patch } : x))
    );
  }

  async function pollStatusUntilDone({ userPhone, instantId, historyId }) {
    const startedAt = Date.now();
    pollAbortRef.current.aborted = false;

    setModalOpen(true);
    setModalTitle("Generating report…");
    setModalSub("Queued. Starting worker…");
    setProgressPct(8);

    // smooth-ish progress animation up to 92%
    const timer = setInterval(() => {
      setProgressPct((p) => {
        if (p >= 92) return p;
        return Math.min(92, p + 1);
      });
    }, 900);

    try {
      while (Date.now() - startedAt < MAX_WAIT_MS) {
        if (pollAbortRef.current.aborted) {
          throw new Error("Polling aborted");
        }

        // GET /status?userPhone=...&instantId=...
        const url = new URL(STATUS_API);
        url.searchParams.set("userPhone", userPhone);
        url.searchParams.set("instantId", instantId);

        const { res, data } = await fetchJson(url.toString(), {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });

        setLastApiResponse(data);

        if (!res.ok || !data?.ok) {
          throw new Error(buildErrorMessage(res, data, "Status check failed"));
        }

        const status = (data.status || "").toLowerCase();
        const errMsg = data.error || data.details || "";

        // reflect status in UI/history
        upsertHistoryItem(historyId, {
          status: data.status || "unknown",
          statusResponse: data,
        });

        if (status === "done") {
          setModalSub("Finalizing… preparing download link");
          setProgressPct(95);
          return data; // contains s3Key sometimes, depending on your status lambda
        }

        if (status === "failed") {
          throw new Error(errMsg || "Report generation failed");
        }

        // still queued/running
        setModalSub(
          status === "running"
            ? "Generating content and charts…"
            : "Queued… waiting for worker"
        );

        await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
      }

      throw new Error(
        `Still running after ${Math.round(MAX_WAIT_MS / 1000)}s. Please wait and try again.`
      );
    } finally {
      clearInterval(timer);
    }
  }

  async function getPresignedUrl({ userPhone, instantId, s3Key }) {
    // Use GET /presign?s3Key=... (preferred) else userPhone+instantId
    const url = new URL(PRESIGN_API);

    if (s3Key) {
      url.searchParams.set("s3Key", s3Key);
    } else {
      url.searchParams.set("userPhone", userPhone);
      url.searchParams.set("instantId", instantId);
    }

    const { res, data } = await fetchJson(url.toString(), {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok || !data?.ok) {
      throw new Error(buildErrorMessage(res, data, "Presign failed"));
    }

    return data.presignedUrl || data.presigned_url || "";
  }

  async function generate() {
    setError("");
    setLastApiResponse(null);

    if (!ensureEnv()) return;

    const t = topic.trim();
    const qs = questions.map((q) => (q || "").trim());

    if (!t) {
      setError("Please enter a topic.");
      return;
    }
    if (qs.some((q) => !q)) {
      setError("Please fill all 5 questions.");
      return;
    }

    setLoading(true);
    setModalOpen(false);
    setProgressPct(5);

    try {
      // 1) Confirm (queue the job)
      const payload = {
        bypass: true,
        employeeId: "10000001",
        query: t,
        questions: qs,
      };

      setModalOpen(true);
      setModalTitle("Generating report…");
      setModalSub("Submitting request…");
      setProgressPct(10);

      const { res, data } = await fetchJson(CONFIRM_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      setLastApiResponse(data);

      if (!res.ok || !data?.ok) {
        throw new Error(buildErrorMessage(res, data, "Request failed"));
      }

      const userPhone = data.userPhone || data.user_phone || "";
      const instantId = data.instantId || data.instant_id || "";
      if (!userPhone || !instantId) {
        throw new Error("Confirm API did not return userPhone + instantId");
      }

      const historyId = `${instantId}-${Date.now()}`;

      const newItem = {
        id: historyId,
        createdAt: data.createdAt || nowIso(),
        topic: t,
        title: data.title || t,
        userPhone,
        instantId,
        status: data.status || "queued",
        s3Key: data.s3Key || "",
        pdfUrl: "",
        apiResponse: data,
      };

      setHistory((prev) => [newItem, ...prev].slice(0, 200));
      setRightId((prevRight) => leftId || prevRight);
      setLeftId(historyId);

      jobRef.current = { userPhone, instantId, historyId };

      // 2) Poll status until done
      const statusData = await pollStatusUntilDone({
        userPhone,
        instantId,
        historyId,
      });

      const finalS3Key =
        statusData?.s3Key ||
        statusData?.s3_key ||
        `instant/${userPhone}/${instantId}.pdf`;

      // 3) Get presigned URL
      const presignedUrl = await getPresignedUrl({
        userPhone,
        instantId,
        s3Key: finalS3Key,
      });

      const finalUrl = withFragmentBuster(presignedUrl);

      upsertHistoryItem(historyId, {
        status: "done",
        s3Key: finalS3Key,
        pdfUrl: finalUrl,
      });

      setModalSub("Ready!");
      setProgressPct(100);

      // close modal after a short moment
      setTimeout(() => {
        setModalOpen(false);
      }, 600);
    } catch (e) {
      setModalOpen(false);
      setError(e?.message || "Server error");
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
    if (!confirm("Clear all generated reports from this page history?")) return;
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
      {/* Loading Modal */}
      {modalOpen ? (
        <div className="modalOverlay">
          <div className="modalCard">
            <div className="modalTitle">{modalTitle}</div>
            <div className="modalSub">{modalSub}</div>

            <div className="progressWrap">
              <div className="progressBar">
                <div
                  className="progressFill"
                  style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }}
                />
              </div>
              <div className="progressPct">{progressPct}%</div>
            </div>

            <div className="modalHint">
              This can take up to ~2 minutes because charts + PDF are generated in the worker.
            </div>
          </div>
        </div>
      ) : null}

      <header className="topbar">
        <div className="topbarLeft">
          <div className="brand">RBR Instant Lite Lab</div>
          <div className="sub">
            Internal testing page — generate reports and compare quality side by side.
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
                <span className="apiLabel">Confirm API</span>{" "}
                <span className="apiValue">{CONFIRM_API || "(missing)"}</span>
              </div>
              <div className="apiLine">
                <span className="apiLabel">Status API</span>{" "}
                <span className="apiValue">{STATUS_API || "(missing)"}</span>
              </div>
              <div className="apiLine">
                <span className="apiLabel">Presign API</span>{" "}
                <span className="apiValue">{PRESIGN_API || "(missing)"}</span>
              </div>

              {error ? <div className="errorBox">Error: {error}</div> : null}
            </div>

            <div className="card" style={{ marginTop: 12 }}>
              <div className="cardTitleRow">
                <div className="cardTitle">Generated Reports</div>
                <div className="mutedSmall">{history.length} items</div>
              </div>

              {!history.length ? (
                <div className="empty">No reports yet. Generate one to start comparing.</div>
              ) : (
                <div className="tableWrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: 140 }}>Time</th>
                        <th>Title / Topic</th>
                        <th style={{ width: 120 }}>Instant ID</th>
                        <th style={{ width: 100 }}>Status</th>
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
                              <div className="titleCell">{h.title || h.topic}</div>
                              <div className="mutedSmall">{h.topic}</div>
                            </td>
                            <td className="mono">{h.instantId || "-"}</td>
                            <td>
                              <span className={`badge ${String(h.status || "").toLowerCase()}`}>
                                {h.status || "-"}
                              </span>
                            </td>
                            <td>
                              <div className="rowActions">
                                <button className="chip" onClick={() => setLeft(h.id)}>
                                  {isLeft ? "Viewing Left" : "View Left"}
                                </button>
                                <button className="chip" onClick={() => setRight(h.id)}>
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
                                  <span className="chipDisabled">No link</span>
                                )}
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

        {/* RIGHT PANEL */}
        <main className="right">
          <div className="compareHeader">
            <div className="compareTitle">Compare PDFs</div>
            <div className="compareHint">
              Pick any two reports from the table (View Left / View Right).
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
                <div className="pdfEmpty">Select a report and click “View Left”.</div>
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
                <div className="pdfEmpty">Select a report and click “View Right”.</div>
              )}
            </div>
          </div>
        </main>
      </div>

      <footer className="footer">
        Tip: Generate multiple reports with small prompt tweaks and compare.
      </footer>
    </div>
  );
}
