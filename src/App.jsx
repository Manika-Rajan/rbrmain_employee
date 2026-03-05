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
 // "FMCG market report India",
 // "EV charging market India",
 // "Restaurant business in India",
 // "Pharma competitor analysis India",
 // "IT industry analysis India",
 // "Paper industry in India",
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
  } catch {}
}

const PREBOOK_STORAGE_KEY = "rbr_prebook_lab_history_v1";

function loadPrebookHistory() {
  try {
    const raw = localStorage.getItem(PREBOOK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function savePrebookHistory(items) {
  try {
    localStorage.setItem(PREBOOK_STORAGE_KEY, JSON.stringify(items));
  } catch {}
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

// IMPORTANT: use fragment buster only (do not add query params to presigned URL)
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
  return x || "unknown";
}

export default function App() {
  // ENV (Amplify env vars)
  const CONFIRM_API = import.meta.env.VITE_CONFIRM_API;
  const STATUS_API = import.meta.env.VITE_STATUS_API;
  const PRESIGN_API = import.meta.env.VITE_PRESIGN_API;

  // PRE-BOOK (experimental) APIs
  const PREBOOK_QUOTA_API = import.meta.env.VITE_PREBOOK_QUOTA_API;
  const PREBOOK_GENERATE_API = import.meta.env.VITE_PREBOOK_GENERATE_API;
  // Optional: separate presign endpoint; falls back to the instant presign API
  const PREBOOK_PRESIGN_API =
    import.meta.env.VITE_PREBOOK_PRESIGN_API || PRESIGN_API;

  const [topic, setTopic] = useState("FMCG market report India");
  const [questions, setQuestions] = useState(DEFAULT_QUESTIONS);

  // Tabs
  const [activeTab, setActiveTab] = useState("instant"); // "instant" | "prebook"

  const isPrebook = activeTab === "prebook";

  // Theme accents
  const theme = useMemo(() => {
    return isPrebook
      ? {
          accent: "#a855f7",
          accentSoft: "rgba(168,85,247,0.16)",
          accentBorder: "rgba(168,85,247,0.35)",
          panelBg: "rgba(10,10,20,0.55)",
        }
      : {
          accent: "#2563eb",
          accentSoft: "rgba(37,99,235,0.16)",
          accentBorder: "rgba(37,99,235,0.35)",
          panelBg: "rgba(10,12,18,0.55)",
        };
  }, [isPrebook]);

  // Pre-book inputs (kept separate from Instant to avoid overwriting)
  const [prebookTopic, setPrebookTopic] = useState("FMCG market report India");
  const [prebookQuestions, setPrebookQuestions] = useState(DEFAULT_QUESTIONS);

  // Pre-book quota display
  const [quota, setQuota] = useState({ limit: 0, used: 0, remaining: 0 });
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [quotaError, setQuotaError] = useState("");

  const [loading, setLoading] = useState(false);
  const [prebookLoading, setPrebookLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastApiResponse, setLastApiResponse] = useState(null);

  const [history, setHistory] = useState(() => loadHistory());
  const [leftId, setLeftId] = useState(null);
  const [rightId, setRightId] = useState(null);

  const [prebookHistory, setPrebookHistory] = useState(() => loadPrebookHistory());
  const [preLeftId, setPreLeftId] = useState(null);
  const [preRightId, setPreRightId] = useState(null);
  const [leftHidden, setLeftHidden] = useState(false);

  // Fancy UX extras
  const [historyQuery, setHistoryQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [toast, setToast] = useState("");
  const [showDebug, setShowDebug] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("Generating report…");
  const [modalSub, setModalSub] = useState("Initializing…");
  const [progressPct, setProgressPct] = useState(5);

  const mountedRef = useRef(true);
  const pollAbortRef = useRef({ aborted: false });

  const headerRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pollAbortRef.current.aborted = true;
    };
  }, []);

  // Keep a CSS variable in sync with the real header height
  // so the sticky header never covers content when scrolling.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;

    const apply = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      document.documentElement.style.setProperty("--header-h", `${h}px`);
    };

    apply();

    let ro;
    try {
      ro = new ResizeObserver(() => apply());
      ro.observe(el);
    } catch {
      // Older browsers: ignore ResizeObserver
    }

    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      if (ro) ro.disconnect();
    };
  }, []);

  useEffect(() => saveHistory(history), [history]);
  useEffect(() => savePrebookHistory(prebookHistory), [prebookHistory]);

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
    if (!prebookHistory.length) return;
    const sorted = [...prebookHistory].sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );
    const first = sorted[0]?.id ?? null;
    const second = sorted[1]?.id ?? null;
    setPreLeftId((prev) => prev ?? first);
    setPreRightId((prev) => prev ?? second ?? first);
  }, [prebookHistory]);


  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 1700);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (activeTab === "prebook") {
      loadQuota();
    }
  }, [activeTab]);


  const activeHistory = activeTab === "instant" ? history : prebookHistory;

  const leftSelId = activeTab === "instant" ? leftId : preLeftId;
  const rightSelId = activeTab === "instant" ? rightId : preRightId;

  const leftItem = useMemo(
    () => activeHistory.find((x) => x.id === leftSelId) || null,
    [activeHistory, leftSelId]
  );
  const rightItem = useMemo(
    () => activeHistory.find((x) => x.id === rightSelId) || null,
    [activeHistory, rightSelId]
  );


  const filteredHistory = useMemo(() => {
    const q = normalize(historyQuery);
    const sf = normalize(statusFilter);
    return [...activeHistory].filter((h) => {
      const matchesQ =
        !q ||
        normalize(h.title).includes(q) ||
        normalize(h.topic).includes(q) ||
        normalize(h.instantId).includes(q) ||
        normalize(h.reportId).includes(q);

      const st = prettyStatus(h.status);
      const matchesStatus = sf === "all" ? true : st === sf;

      return matchesQ && matchesStatus;
    });
  }, [activeHistory, historyQuery, statusFilter]);

  function updateQuestion(i, val) {
    setQuestions((prev) => prev.map((q, idx) => (idx === i ? val : q)));
  }


  function updatePrebookQuestion(i, val) {
    setPrebookQuestions((prev) => prev.map((q, idx) => (idx === i ? val : q)));
  }

  async function loadQuota() {
    setQuotaError("");
    if (!ensurePrebookEnv()) return;

    setQuotaLoading(true);
    try {
      const { res, data } = await fetchJson(PREBOOK_QUOTA_API, {
        method: "GET",
      });

      if (!res.ok || !data?.ok) {
        throw new Error(buildErrorMessage(res, data, "Quota API failed"));
      }

      setQuota({
        limit: Number(data.limit || 0),
        used: Number(data.used || 0),
        remaining: Number(data.remaining || 0),
      });
    } catch (e) {
      setQuotaError(e?.message || "Failed to load quota");
    } finally {
      setQuotaLoading(false);
    }
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


  function ensurePrebookEnv() {
    const missing = [];
    if (!PREBOOK_QUOTA_API) missing.push("VITE_PREBOOK_QUOTA_API");
    if (!PREBOOK_GENERATE_API) missing.push("VITE_PREBOOK_GENERATE_API");
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
    setModalSub("Queued • starting worker");
    setProgressPct(8);

    const timer = setInterval(() => {
      if (!mountedRef.current) return;
      setProgressPct((p) => (p >= 92 ? p : Math.min(92, p + 1)));
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

  async function getPresignedUrl({ userPhone, instantId, s3Key, api }) {
    const endpoint = api || PRESIGN_API;
    const url = new URL(endpoint);
    if (s3Key) url.searchParams.set("s3Key", s3Key);
    else {
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
    pollAbortRef.current.aborted = true;

    if (!ensureEnv()) return;

    const t = topic.trim();
    const qs = questions.map((q) => (q || "").trim());

    if (!t) return setError("Please enter a topic.");
    if (qs.some((q) => !q)) return setError("Please fill all 5 questions.");

    setLoading(true);
    setProgressPct(5);

    try {
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
      setLeftId(historyId);

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
      setTimeout(() => mountedRef.current && setModalOpen(false), 550);
    } catch (e) {
      if (!mountedRef.current) return;
      setModalOpen(false);
      setError(e?.message || "Server error");
    } finally {
      if (!mountedRef.current) return;
      setLoading(false);
    }
  }


  function upsertPrebookItem(id, patch) {
    setPrebookHistory((prev) =>
      prev.map((x) => (x.id === id ? { ...x, ...patch } : x))
    );
  }

  async function generatePrebook() {
    setError("");
    setQuotaError("");
    setLastApiResponse(null);

    if (!ensurePrebookEnv()) return;

    const t = prebookTopic.trim();
    const qs = prebookQuestions.map((q) => (q || "").trim());

    if (!t) return setError("Please enter a topic.");
    if (qs.some((q) => !q)) return setError("Please fill all 5 questions.");

    // Enforce global daily cap (shown in UI)
    if ((quota?.remaining ?? 0) <= 0) {
      return setError("Daily Pre-book limit reached. Try again tomorrow.");
    }

    setPrebookLoading(true);

    try {
      const payload = {
        bypass: true,
        employeeId: "10000001",
        query: t,
        questions: qs,
      };

      // Create an optimistic history item immediately
      const historyId = `prebook-${Date.now()}`;
      const newItem = {
        id: historyId,
        createdAt: nowIso(),
        topic: t,
        title: t,
        reportId: "",
        status: "running",
        pdfUrl: "",
        s3Key: "",
        raw: null,
      };

      setPrebookHistory((prev) => [newItem, ...prev]);

      const { res, data } = await fetchJson(PREBOOK_GENERATE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      setLastApiResponse(data);

      if (!res.ok || !data?.ok) {
        throw new Error(buildErrorMessage(res, data, "Pre-book generate failed"));
      }

      const reportId = data.reportId || data.report_id || data.prebookId || data.id || "";
      const s3Key = data.s3Key || data.s3_key || "";
      const presignedUrl =
        data.presignedUrl || data.presigned_url || data.url || data.presignedURL || "";

      let pdfUrl = presignedUrl;

      // If backend doesn't return a URL, try presign using s3Key
      if (!pdfUrl && s3Key) {
        const { presignedUrl: u } = await getPresignedUrl({
          s3Key,
          api: PREBOOK_PRESIGN_API,
        });
        pdfUrl = u;
      }

      upsertPrebookItem(historyId, {
        title: data.title || t,
        reportId,
        status: data.status || "done",
        s3Key,
        pdfUrl: pdfUrl ? bustPdfUrl(pdfUrl) : "",
        raw: data,
      });

      // Refresh quota numbers in UI
      await loadQuota();
      setToast("Pre-book report generated ✅");
    } catch (e) {
      setError(e?.message || "Pre-book generation failed");
      setToast("Pre-book generation failed");
    } finally {
      setPrebookLoading(false);
    }
  }

  function setLeft(itemId) {
    if (activeTab === "instant") {
      setLeftId(itemId);
      if (itemId === rightId) {
        const alt = history.find((x) => x.id !== itemId)?.id || itemId;
        setRightId(alt);
      }
    } else {
      setPreLeftId(itemId);
      if (itemId === preRightId) {
        const alt = prebookHistory.find((x) => x.id !== itemId)?.id || itemId;
        setPreRightId(alt);
      }
    }
  }

  function setRight(itemId) {
    if (activeTab === "instant") {
      setRightId(itemId);
      if (itemId === leftId) {
        const alt = history.find((x) => x.id !== itemId)?.id || itemId;
        setLeftId(alt);
      }
    } else {
      setPreRightId(itemId);
      if (itemId === preLeftId) {
        const alt = prebookHistory.find((x) => x.id !== itemId)?.id || itemId;
        setPreLeftId(alt);
      }
    }
  }

  function removeItem(itemId) {
    if (activeTab === "instant") {
      setHistory((prev) => prev.filter((x) => x.id !== itemId));
      if (leftId === itemId) setLeftId(null);
      if (rightId === itemId) setRightId(null);
    } else {
      setPrebookHistory((prev) => prev.filter((x) => x.id !== itemId));
      if (preLeftId === itemId) setPreLeftId(null);
      if (preRightId === itemId) setPreRightId(null);
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
    <div className={clsx("page", isPrebook && "themePrebook")} data-theme={isPrebook ? "prebook" : "instant"}
      style={{
        minHeight: "100vh",
        height: "auto",
        overflowX: "clip",
        //overflowY: "auto",
        backgroundColor: isPrebook ? "rgb(10, 8, 18)" : "rgb(8, 12, 20)",
        backgroundImage: isPrebook
          ? "radial-gradient(1200px 700px at 18% -10%, rgba(168,85,247,0.26), transparent 55%), radial-gradient(900px 500px at 88% 0%, rgba(236,72,153,0.20), transparent 55%), radial-gradient(1000px 650px at 50% 110%, rgba(59,130,246,0.12), transparent 60%)"
          : "radial-gradient(1200px 700px at 18% -10%, rgba(37,99,235,0.22), transparent 55%), radial-gradient(900px 500px at 88% 0%, rgba(14,165,233,0.16), transparent 55%), radial-gradient(1000px 650px at 50% 110%, rgba(99,102,241,0.10), transparent 60%)",
      }}>
      {/* Ambient background */}
      <div className="aurora" aria-hidden="true" />
      <div className="noise" aria-hidden="true" />

      {/* Toast */}
      {toast ? <div className="toast">{toast}</div> : null}

      {/* Modal */}
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
              Charts + PDF are generated in the worker. Typical: 30–90s. Worst:
              ~2 minutes.
            </div>
          </div>
        </div>
      ) : null}

      {/* SHELL fixes cropping: header + body with internal scroll */}
      <div className={clsx("shell", isPrebook && "themePrebook")} style={{ width: "100%", maxWidth: "none", overflow: "visible" }}>
        <header className="topbar" ref={headerRef}
          style={{
            position: "relative",
            
            zIndex: 100,
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            borderBottom: `1px solid ${theme.accentBorder}`,
            background: isPrebook
              ? "linear-gradient(180deg, rgba(20,10,40,0.78), rgba(10,8,18,0.58))"
              : "linear-gradient(180deg, rgba(10,18,40,0.78), rgba(8,12,20,0.58))",
            boxShadow: isPrebook
              ? "0 10px 40px rgba(168,85,247,0.16)"
              : "0 10px 40px rgba(37,99,235,0.16)",
          }}>
          <div className="topbarLeft">
            <div className="brandRow">
              <div className="brand">RBR Report Lab</div>
              <span className="pill">Internal</span>
            </div>
            <div className="sub">
              Generate multiple reports and compare quality side-by-side.
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                className="chipPill"
                onClick={() => setActiveTab("instant")}
                style={{
                  border: activeTab === "instant" ? "1px solid rgba(37,99,235,0.55)" : "1px solid rgba(255,255,255,0.14)",
                  background: activeTab === "instant" ? "rgba(37,99,235,0.18)" : "rgba(255,255,255,0.08)",
                  color: activeTab === "instant" ? "rgba(219,234,254,0.98)" : "rgba(255,255,255,0.88)",
                }}
              >
                Instant Report Work Desk
              </button>
              <button
                type="button"
                className="chipPill"
                onClick={() => setActiveTab("prebook")}
                style={{
                  border: activeTab === "prebook" ? `1px solid ${theme.accentBorder}` : "1px solid rgba(255,255,255,0.14)",
                  background: activeTab === "prebook" ? theme.accentSoft : "rgba(255,255,255,0.08)",
                  color: activeTab === "prebook" ? "rgba(245,208,254,0.98)" : "rgba(255,255,255,0.88)",
                }}
              >
                Pre-book Report Work Desk
              </button>
            </div>

            {activeTab === "instant" ? (
              <div className="quickChips">
                {QUICK_TOPICS.map((t) => (
                  <button
                    key={t}
                    className="chipPill"
                    onClick={() => setTopic(t)}
                    type="button"
                    title="Use this topic"
                  >
                    {t}
                  </button>
                ))}
              </div>
            ) : null}

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

        {isPrebook && !leftHidden && (
          <section
            className="card glass"
            style={{
              position: "relative",
              
              zIndex: 90,
              marginTop: 14,
              marginBottom: 14,
              border: `1px solid ${theme.accentBorder}`,
              background: theme.panelBg,
              boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <div className="mutedSmall">Daily limit</div>
                  <div className="mono" style={{ fontSize: 16 }}>{quota.limit}</div>
                </div>
                <div>
                  <div className="mutedSmall">Generated today</div>
                  <div className="mono" style={{ fontSize: 16 }}>{quota.used}</div>
                </div>
                <div>
                  <div className="mutedSmall">Remaining</div>
                  <div className="mono" style={{ fontSize: 16 }}>{quota.remaining}</div>
                </div>
                {quota.remaining <= 0 ? (
                  <span
                    style={{
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.20)",
                      background: "rgba(255,255,255,0.06)",
                      fontSize: 12,
                    }}
                  >
                    Limit reached
                  </span>
                ) : null}
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button className="linkBtn" onClick={loadQuota} type="button">
                  {quotaLoading ? "Refreshing…" : "Refresh quota"}
                </button>
                <button className="linkBtn" onClick={() => setPrebookQuestions(DEFAULT_QUESTIONS)} type="button">
                  Reset questions
                </button>
                <button
                  className="primaryBtn"
                  type="button"
                  disabled={prebookLoading || quota.remaining <= 0}
                  onClick={generatePrebook}
                  style={{
                    background: theme.accentSoft,
                    border: `1px solid ${theme.accentBorder}`,
                    color: "rgba(255,255,255,0.92)",
                  }}
                  title={quota.remaining <= 0 ? "Daily limit reached" : "Generate a Pre-book report"}
                >
                  {prebookLoading ? "Generating…" : "Generate (Pre-book)"}
                </button>
              </div>
            </div>

            {quotaError ? (
              <div className="mutedSmall" style={{ marginTop: 10 }}>
                {quotaError}
              </div>
            ) : null}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(260px, 1.1fr) minmax(320px, 2fr)",
                gap: 14,
                marginTop: 14,
                alignItems: "start",
              }}
            >
              <div>
                <label className="label">Topic</label>
                <input
                  className="input"
                  value={prebookTopic}
                  onChange={(e) => setPrebookTopic(e.target.value)}
                  placeholder="e.g., Indian EV charging market 2026"
                  style={{
                    borderColor: theme.accentBorder,
                  }}
                />

                <div className="quickChips" style={{ marginTop: 10 }}>
                  {QUICK_TOPICS.map((t) => (
                    <button
                      key={t}
                      className="chipPill"
                      onClick={() => setPrebookTopic(t)}
                      type="button"
                      title="Use this topic"
                      style={{
                        borderColor: theme.accentBorder,
                        background: "rgba(255,255,255,0.06)",
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <label className="label" style={{ margin: 0 }}>
                    Questions
                  </label>
                  <span className="mutedSmall">Edit these — they go into the report prompt</span>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                    gap: 12,
                    marginTop: 8,
                  }}
                >
                  {prebookQuestions.map((q, i) => (
                    <div key={i} className="qBlock" style={{ margin: 0 }}>
                      <label className="label">Q{i + 1}</label>
                      <textarea
                        className="textarea"
                        value={q}
                        onChange={(e) => updatePrebookQuestion(i, e.target.value)}
                        rows={2}
                        style={{ borderColor: "rgba(255,255,255,0.16)" }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        <div className={clsx("body", (leftHidden || isPrebook) && "bodyFull")}>
          {/* LEFT */}
          {!leftHidden && !isPrebook && (
            <aside className="left">
              <div className="panelScroll">
                {activeTab === "instant" ? (
                  <div className="card glass">
                    <div className="cardTitleRow">
                      <div className="cardTitle">Generate (Instant)</div>
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
                    </div>

                    {error ? <div className="errorBox">Error: {error}</div> : null}
                  </div>
                ) : (
                  <div className="card glass">
                    <div className="cardTitleRow">
                      <div className="cardTitle">Generate (Pre-book)</div>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <button className="linkBtn" onClick={loadQuota} type="button">
                          {quotaLoading ? "Refreshing…" : "Refresh quota"}
                        </button>
                        <button
                          className="linkBtn"
                          onClick={() => setPrebookQuestions(DEFAULT_QUESTIONS)}
                          type="button"
                        >
                          Reset questions
                        </button>
                      </div>
                    </div>

                    <div className="hintBox" style={{ marginTop: 10 }}>
                      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                        <div>
                          <div className="mutedSmall">Daily limit</div>
                          <div className="mono" style={{ fontSize: 16 }}>{quota.limit}</div>
                        </div>
                        <div>
                          <div className="mutedSmall">Generated today</div>
                          <div className="mono" style={{ fontSize: 16 }}>{quota.used}</div>
                        </div>
                        <div>
                          <div className="mutedSmall">Remaining</div>
                          <div className="mono" style={{ fontSize: 16 }}>{quota.remaining}</div>
                        </div>
                      </div>
                      {quotaError ? (
                        <div className="mutedSmall" style={{ marginTop: 8 }}>
                          {quotaError}
                        </div>
                      ) : null}
                      {quota.remaining <= 0 ? (
                        <div className="mutedSmall" style={{ marginTop: 8 }}>
                          Daily limit reached — generation disabled.
                        </div>
                      ) : null}
                    </div>

                    <label className="label" style={{ marginTop: 12 }}>Topic</label>
                    <input
                      className="input"
                      value={prebookTopic}
                      onChange={(e) => setPrebookTopic(e.target.value)}
                      placeholder="e.g., Indian EV charging market 2026"
                    />

                    <div className="qGrid">
                      {prebookQuestions.map((q, i) => (
                        <div key={i} className="qBlock">
                          <label className="label">Question {i + 1}</label>
                          <textarea
                            className="textarea"
                            value={q}
                            onChange={(e) => updatePrebookQuestion(i, e.target.value)}
                            rows={2}
                          />
                        </div>
                      ))}
                    </div>

                    <div className="actions">
                      <button
                        className="btn"
                        onClick={generatePrebook}
                        disabled={prebookLoading || quota.remaining <= 0}
                      >
                        {prebookLoading ? "Generating..." : "Generate PDF"}
                      </button>
                    </div>

                    {error ? <div className="errorBox">Error: {error}</div> : null}
                  </div>
                )}

                <div className="card" style={{ marginTop: 12 }}>
                  <div className="cardTitleRow">
                    <div className="cardTitle">Generated Reports ({activeTab === "instant" ? "Instant" : "Pre-book"})</div>
                    <div className="mutedSmall">{activeHistory.length} items</div>
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
                      <option value="all">All</option>
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
                            <th style={{ width: 150 }}>Time</th>
                            <th>Topic</th>
                            <th style={{ width: 140 }}>{activeTab === "instant" ? "Instant" : "Pre-book"}</th>
                            <th style={{ width: 105 }}>Status</th>
                            <th style={{ width: 320 }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredHistory.map((h) => {
                            const dt = h.createdAt ? new Date(h.createdAt) : null;
                            const timeStr = dt ? dt.toLocaleString() : "-";
                            const st = prettyStatus(h.status);
                            return (
                              <tr key={h.id} className="row">
                                <td className="mono">{timeStr}</td>
                                <td>
                                  <div className="titleCell">{h.title || h.topic}</div>
                                  <div className="mutedSmall">{h.topic}</div>
                                </td>
                                <td className="mono">
                                  <div className="monoRow">
                                    <span>{activeTab === "instant" ? (h.instantId || "-") : (h.reportId || "-")}</span>
                                    {(activeTab === "instant" ? h.instantId : h.reportId) ? (
                                      <button
                                        className="miniBtn"
                                        onClick={() => copyToClipboard(activeTab === "instant" ? h.instantId : h.reportId)}
                                        type="button"
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
                                    <button className="chip" onClick={() => setLeft(h.id)} type="button">
                                      View Left
                                    </button>
                                    <button className="chip" onClick={() => setRight(h.id)} type="button">
                                      View Right
                                    </button>
                                    {h.pdfUrl ? (
                                      <a className="chipLink" href={h.pdfUrl} target="_blank" rel="noreferrer">
                                        Open
                                      </a>
                                    ) : (
                                      <span className="chipDisabled">No link</span>
                                    )}
                                    <button className="chipDanger" onClick={() => removeItem(h.id)} type="button">
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
                        onClick={() =>
                          copyToClipboard(JSON.stringify(lastApiResponse, null, 2))
                        }
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
              </div>
            </aside>
          )}

          {/* RIGHT */}
          <main className="right">
            <div className="compareHeader">
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
                Choose “View Left / View Right” from the table. No cropping — panes fit the screen.
              </div>
            </div>

            <div className="pdfGrid">
              <section className="pdfPane">
                <div className="pdfPaneHeader">
                  <div className="paneTitle">Left</div>
                  <div className="paneMeta">
                    {leftItem ? (
                      <>
                        <span className="mono">{leftItem.instantId || leftItem.reportId || leftItem.id}</span>
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

                <div className="pdfFill">
                  {leftItem?.pdfUrl ? (
                    <iframe className="pdfFrame" src={leftItem.pdfUrl} title="Left PDF" />
                  ) : (
                    <div className="pdfEmpty fancyEmpty">
                      <div className="emptyIcon">⬅️</div>
                      <div className="emptyTitle">Select a Left report</div>
                      <div className="mutedSmall">Use “View Left” in the table.</div>
                    </div>
                  )}
                </div>
              </section>

              <section className="pdfPane">
                <div className="pdfPaneHeader">
                  <div className="paneTitle">Right</div>
                  <div className="paneMeta">
                    {rightItem ? (
                      <>
                        <span className="mono">{rightItem.instantId || rightItem.reportId || rightItem.id}</span>
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

                <div className="pdfFill">
                  {rightItem?.pdfUrl ? (
                    <iframe className="pdfFrame" src={rightItem.pdfUrl} title="Right PDF" />
                  ) : (
                    <div className="pdfEmpty fancyEmpty">
                      <div className="emptyIcon">➡️</div>
                      <div className="emptyTitle">Select a Right report</div>
                      <div className="mutedSmall">Use “View Right” in the table.</div>
                    </div>
                  )}
                </div>
              </section>
            </div>
          </main>
        </div>

        <footer className="footer">
          Tip: Generate 2–3 reports with small prompt changes and compare output quality.
        </footer>
      </div>
    </div>
  );
}
