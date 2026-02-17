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

const QUICK_TOPICS = [
  "FMCG market report India",
  "EV charging market India",
  "Restaurant business in India",
  "Pharma competitor analysis India",
  "IT industry analysis India",
  "Paper industry in India",
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
    (typeof data?.raw === "string" && data.raw.slice(0, 300)) ||
    fallback;

  return base || fallback || `HTTP ${res?.status || "error"}`;
}

// IMPORTANT: Use fragment buster only (never add query params to presigned URL)
function withFragmentBuster(url) {
  if (!url) return url;
  const base = url.split("#")[0];
  return `${base}#ts=${Date.now()}`;
}

function clsx(...parts) {
  return parts.filter(Boolean).join(" ");
}

function normalize(s) {
  return String(s || "").trim().toLowerCase();
}

function prettyStatus(s) {
  const x = normalize(s);
  if (!x) return "unknown";
  return x;
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

  // Fancy additions (no dependencies)
  const [historyQuery, setHistoryQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showDebug, setShowDebug] = useState(false);
  const [toast, setToast] = useState("");

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("Generating report…");
  const [modalSub, setModalSub] = useState("Initializing…");
  const [progressPct, setProgressPct] = useState(5);

  // Avoid setState after unmount
  const mountedRef = useRef(true);

  // Poll cancel flag
  const pollAbortRef = useRef({ aborted: false });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pollAbortRef.current.aborted = true;
    };
  }, []);

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

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  const leftItem = useMemo(
    () => history.find((x) => x.id === leftId) || null,
    [history, leftId]
  );
  const rightItem = useMemo(
    () => history.find((x) => x.id === rightId) || null,
    [history, rightId]
  );

  const filteredHistory = useMemo(() => {
    const q = normalize(historyQuery);
    const sf = normalize(statusFilter);
    return [...history].filter((h) => {
      const matchesQ =
        !q ||
        normalize(h.title).includes(q) ||
        normalize(h.topic).includes(q) ||
        normalize(h.instantId).includes(q);

      const st = prettyStatus(h.status);
      const matchesStatus = sf === "all" ? true : st === sf;

      return matchesQ && matchesStatus;
    });
  }, [history, historyQuery, statusFilter]);

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

    if (!mountedRef.current) return null;

    setModalOpen(true);
    setModalTitle("Generating report…");
    setModalSub("Queued • starting worker");
    setProgressPct(8);

    // Smooth progress animation up to 92%
    const timer = setInterval(() => {
      if (!mountedRef.current) return;
      setProgressPct((p) => {
        if (p >= 92) return p;
        return Math.min(92, p + 1);
      });
    }, 850);

    try {
      while (Date.now() - startedAt < MAX_WAIT_MS) {
        if (!mountedRef.current) throw new Error("Page closed");
        if (pollAbortRef.current.aborted) throw new Error("Polling aborted");

        const url = new URL(STATUS_API);
        url.searchParams.set("userPhone", userPhone);
        url.searchParams.set("instantId", instantId);

        const { res, data } = await fetchJson(url.toString(), {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });

        if (!mountedRef.current) throw new Error("Page closed");

        setLastApiResponse(data);

        if (!res.ok || !data?.ok) {
          throw new Error(buildErrorMessage(res, data, "Status check failed"));
        }

        const status = prettyStatus(data.status);
        const errMsg = data.error || data.details || "";

        upsertHistoryItem(historyId, {
          status: data.status || "unknown",
          statusResponse: data,
          s3Key: data.s3Key || data.s3_key || "",
          title: data.title || undefined,
          subtitle: data.subtitle || undefined,
        });

        if (status === "done") {
          setModalSub("Finalizing • preparing download link");
          setProgressPct(95);
          return data;
        }

        if (status === "failed") {
          throw new Error(errMsg || "Report generation failed");
        }

        setModalSub(
          status === "running"
            ? "Running • generating content + charts"
            : "Queued • waiting for worker"
        );

        await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
      }

      throw new Error(
        `Still running after ${Math.round(
          MAX_WAIT_MS / 1000
        )}s. Please wait and try again.`
      );
    } finally {
      clearInterval(timer);
    }
  }

  async function getPresignedUrl({ userPhone, instantId, s3Key }) {
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

    if (!res.ok) throw new Error(buildErrorMessage(res, data, "Presign failed"));

    const ok = data?.ok;
    if (ok === false) throw new Error(buildErrorMessage(res, data, "Presign failed"));

    const u =
      data?.presignedUrl ||
      data?.presigned_url ||
      data?.url ||
      data?.presignedURL ||
      "";

    if (!u) throw new Error("Presign API returned no URL");
    return u;
  }

  async function generate() {
    setError("");
    setLastApiResponse(null);
    pollAbortRef.current.aborted = true; // stop any previous polling loops

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
      setModalSub("Submitting request");
      setProgressPct(12);

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

      // 2) Poll status until done
      const statusData = await pollStatusUntilDone({
        userPhone,
        instantId,
        historyId,
      });

      if (!statusData || !mountedRef.current) return;

      const finalS3Key =
        statusData?.s3Key ||
        statusData?.s3_key ||
        `instant/${userPhone}/${instantId}.pdf`;

      // 3) Presign
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
        title: statusData.title || undefined,
        subtitle: statusData.subtitle || undefined,
      });

      setModalSub("Ready");
      setProgressPct(100);

      setTimeout(() => {
        if (!mountedRef.current) return;
        setModalOpen(false);
      }, 550);
    } catch (e) {
      if (!mountedRef.current) return;
      setModalOpen(false);
      setError(e?.message || "Server error");
    } finally {
      if (!mountedRef.current) return;
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

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(String(text || ""));
      setToast("Copied ✅");
    } catch {
      setToast("Copy failed");
    }
  }

  const leftStatus = prettyStatus(leftItem?.status);
  const rightStatus = prettyStatus(rightItem?.status);

  return (
    <div className="page">
      {/* Toast */}
      {toast ? <div className="toast">{toast}</div> : null}

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
                  style={{
                    width: `${Math.max(0, Math.min(100, progressPct))}%`,
                  }}
                />
              </div>
              <div className="progressPct">{progressPct}%</div>
            </div>

            <div className="modalHint">
              Worker generates charts + PDF. Typical: 30–90s. Worst: ~2 minutes.
            </div>
          </div>
        </div>
      ) : null}

      {/* Hero / Topbar */}
      <header className="topbar">
        <div className="topbarLeft">
          <div className="brandRow">
            <div className="brand">RBR Instant Lab</div>
            <span className="pill">Internal</span>
          </div>
          <div className="sub">
            Generate multiple reports and compare quality side-by-side.
          </div>

          <div className="quickChips">
            {QUICK_TOPICS.map((t) => (
              <button
                key={t}
                className="chipPill"
                onClick={() => setTopic(t)}
                title="Use this topic"
                type="button"
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="topbarRight">
          <button
            className="btnSecondary"
            onClick={() => setShowDebug((v) => !v)}
            type="button"
          >
            {showDebug ? "Hide Debug" : "Show Debug"}
          </button>

          <button
            className="btnSecondary"
            onClick={() => setLeftHidden((v) => !v)}
            type="button"
          >
            {leftHidden ? "Show Inputs" : "Hide Inputs"}
          </button>
        </div>
      </header>

      <div className={clsx("layout", leftHidden && "layoutFull")}>
        {/* LEFT PANEL */}
        {!leftHidden && (
          <aside className="left">
            <div className="card glass">
              <div className="cardTitleRow">
                <div className="cardTitle">Generate</div>
                <button
                  className="linkBtn"
                  onClick={() => setQuestions(DEFAULT_QUESTIONS)}
                  type="button"
                >
                  Reset questions
                </button>
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
                  <div key={i} className="qBlock">
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
                <button className="btn" onClick={generate} disabled={loading}>
                  {loading ? "Generating..." : "Generate PDF"}
                </button>

                <button
                  className="btnSecondary"
                  onClick={retry}
                  disabled={loading}
                  title="Retry the same request"
                  type="button"
                >
                  Retry
                </button>

                <button
                  className="btnDanger"
                  onClick={clearHistory}
                  disabled={!history.length || loading}
                  type="button"
                >
                  Clear history
                </button>
              </div>

              <div className="envBox">
                <div className="envRow">
                  <span className="envKey">Confirm</span>
                  <span className="envVal">{CONFIRM_API || "(missing)"}</span>
                </div>
                <div className="envRow">
                  <span className="envKey">Status</span>
                  <span className="envVal">{STATUS_API || "(missing)"}</span>
                </div>
                <div className="envRow">
                  <span className="envKey">Presign</span>
                  <span className="envVal">{PRESIGN_API || "(missing)"}</span>
                </div>
              </div>

              {error ? <div className="errorBox">Error: {error}</div> : null}
            </div>

            <div className="card" style={{ marginTop: 12 }}>
              <div className="cardTitleRow">
                <div className="cardTitle">Generated Reports</div>
                <div className="mutedSmall">{history.length} items</div>
              </div>

              <div className="historyTools">
                <input
                  className="input inputSm"
                  value={historyQuery}
                  onChange={(e) => setHistoryQuery(e.target.value)}
                  placeholder="Search title / topic / instantId…"
                />
                <select
                  className="select"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">All status</option>
                  <option value="queued">queued</option>
                  <option value="running">running</option>
                  <option value="done">done</option>
                  <option value="failed">failed</option>
                  <option value="unknown">unknown</option>
                </select>
              </div>

              {!filteredHistory.length ? (
                <div className="empty fancyEmpty">
                  <div className="emptyIcon">📄</div>
                  <div className="emptyTitle">No matching reports</div>
                  <div className="mutedSmall">
                    Generate a report, or clear the search/filter.
                  </div>
                </div>
              ) : (
                <div className="tableWrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: 155 }}>Time</th>
                        <th>Title / Topic</th>
                        <th style={{ width: 130 }}>Instant ID</th>
                        <th style={{ width: 110 }}>Status</th>
                        <th style={{ width: 320 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredHistory.map((h) => {
                        const dt = h.createdAt ? new Date(h.createdAt) : null;
                        const timeStr = dt ? dt.toLocaleString() : "-";
                        const isLeft = h.id === leftId;
                        const isRight = h.id === rightId;

                        const st = prettyStatus(h.status);

                        return (
                          <tr
                            key={h.id}
                            className={clsx(
                              "row",
                              (isLeft || isRight) && "rowSelected"
                            )}
                          >
                            <td className="mono">{timeStr}</td>
                            <td>
                              <div className="titleCell">
                                {h.title || h.topic}
                              </div>
                              <div className="mutedSmall">{h.topic}</div>
                            </td>
                            <td className="mono">
                              <div className="monoRow">
                                <span>{h.instantId || "-"}</span>
                                {h.instantId ? (
                                  <button
                                    className="miniBtn"
                                    onClick={() => copyToClipboard(h.instantId)}
                                    type="button"
                                    title="Copy Instant ID"
                                  >
                                    Copy
                                  </button>
                                ) : null}
                              </div>
                            </td>
                            <td>
                              <span className={clsx("badge", `st-${st}`)}>
                                {h.status || "-"}
                              </span>
                            </td>
                            <td>
                              <div className="rowActions">
                                <button
                                  className={clsx(
                                    "chip",
                                    isLeft && "chipActive"
                                  )}
                                  onClick={() => setLeft(h.id)}
                                  type="button"
                                >
                                  {isLeft ? "Viewing Left" : "View Left"}
                                </button>
                                <button
                                  className={clsx(
                                    "chip",
                                    isRight && "chipActive"
                                  )}
                                  onClick={() => setRight(h.id)}
                                  type="button"
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
                                  <span className="chipDisabled">No link</span>
                                )}

                                <button
                                  className="chipDanger"
                                  onClick={() => removeItem(h.id)}
                                  type="button"
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

            {showDebug && lastApiResponse ? (
              <div className="card" style={{ marginTop: 12 }}>
                <div className="cardTitleRow">
                  <div className="cardTitle">API Response (debug)</div>
                  <button
                    className="linkBtn"
                    onClick={() => copyToClipboard(JSON.stringify(lastApiResponse, null, 2))}
                    type="button"
                  >
                    Copy JSON
                  </button>
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
          <div className="compareHeader sticky">
            <div className="compareTitleRow">
              <div className="compareTitle">Compare PDFs</div>
              <div className="compareBadges">
                <span className={clsx("miniStatus", `st-${leftStatus}`)}>
                  Left: {leftItem?.status || "none"}
                </span>
                <span className={clsx("miniStatus", `st-${rightStatus}`)}>
                  Right: {rightItem?.status || "none"}
                </span>
              </div>
            </div>
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
                  key={leftItem.pdfUrl}
                  className="pdfFrame"
                  src={leftItem.pdfUrl}
                  title="Left PDF"
                />
              ) : (
                <div className="pdfEmpty fancyEmpty">
                  <div className="emptyIcon">⬅️</div>
                  <div className="emptyTitle">Select a Left report</div>
                  <div className="mutedSmall">
                    Use “View Left” from the table.
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
                  key={rightItem.pdfUrl}
                  className="pdfFrame"
                  src={rightItem.pdfUrl}
                  title="Right PDF"
                />
              ) : (
                <div className="pdfEmpty fancyEmpty">
                  <div className="emptyIcon">➡️</div>
                  <div className="emptyTitle">Select a Right report</div>
                  <div className="mutedSmall">
                    Use “View Right” from the table.
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      <footer className="footer">
        Tip: generate 2–3 reports with small prompt tweaks and compare results.
      </footer>
    </div>
  );
}
