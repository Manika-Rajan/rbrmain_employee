import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const MAX_WAIT_MS = 120000;
const POLL_EVERY_MS = 2500;

const DEFAULT_QUESTIONS = [
  "What is the current market overview and market size, with recent trends?",
  "What are the key segments/sub-segments and how is demand distributed?",
  "What are the main growth drivers, constraints, risks, and challenges?",
  "Who are the key players and what is the competitive landscape?",
  "What is the 3–5 year outlook with opportunities and recommendations?",
];

const QUICK_TOPICS = [];

const STORAGE_KEY = "rbr_instant_lab_history_v2";
const PREBOOK_STORAGE_KEY = "rbr_prebook_lab_history_v1";
const PREBOOK_TEMPLATES_KEY = "rbr_prebook_templates_v1";
const PREBOOK_ACTIVE_TEMPLATE_KEY = "rbr_prebook_active_template_id_v1";

const CHART_TYPES = [
  "none",
  "line",
  "bar",
  "stacked_bar",
  "pie",
  "donut",
  "area",
  "scatter",
  "heatmap",
];

const DEFAULT_PREBOOK_BRIEF = {
  objective: "",
  audience: "",
  geography: "India",
  horizon: "3-5 years",
  depth: "detailed",
  tone: "strategic",
  includeCharts: "balanced",
  includeTables: "balanced",
  competitorCoverage: "top_10",
  includeAssumptions: true,
  mentionDataGaps: true,
  sectionRecommendations: true,
  includeScorecard: false,
  mustInclude: "",
  avoidNotes: "",
};

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

function loadPrebookHistory() {
  try {
    const raw = localStorage.getItem(PREBOOK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePrebookHistory(items) {
  try {
    localStorage.setItem(PREBOOK_STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

function loadPrebookTemplates() {
  try {
    const raw = localStorage.getItem(PREBOOK_TEMPLATES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePrebookTemplates(items) {
  try {
    localStorage.setItem(PREBOOK_TEMPLATES_KEY, JSON.stringify(items));
  } catch {}
}

function loadActivePrebookTemplateId() {
  try {
    return localStorage.getItem(PREBOOK_ACTIVE_TEMPLATE_KEY) || "";
  } catch {
    return "";
  }
}

function saveActivePrebookTemplateId(id) {
  try {
    localStorage.setItem(PREBOOK_ACTIVE_TEMPLATE_KEY, id || "");
  } catch {}
}

function makeTemplateId() {
  return `tmpl_${Math.random().toString(16).slice(2, 10)}`;
}

function makeEmptyTemplate() {
  const now = new Date().toISOString();
  return {
    id: makeTemplateId(),
    name: "",
    targetAudience: "",
    description: "",
    version: 1,
    createdAt: now,
    updatedAt: now,
    layout: [
      {
        pageTitle: "Executive Summary",
        sections: [
          {
            heading: "Market Snapshot",
            subsections: [
              {
                title: "Key trends",
                chart: { type: "line", notes: "" },
                table: { columns: ["Metric", "Value"], rowLimit: 12 },
                bodyNotes: "",
              },
            ],
          },
        ],
      },
    ],
  };
}

function nowIso() {
  return new Date().toISOString();
}

function formatReportTimestamp(date = new Date()) {
  try {
    return date.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return date.toISOString();
  }
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

function deepClone(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return obj;
  }
}

function moveArrayItem(arr, from, to) {
  const a = Array.isArray(arr) ? [...arr] : [];
  if (from < 0 || from >= a.length) return a;
  const target = Math.max(0, Math.min(a.length - 1, to));
  if (target === from) return a;
  const [item] = a.splice(from, 1);
  a.splice(target, 0, item);
  return a;
}

function templateStats(template) {
  const layout = Array.isArray(template?.layout) ? template.layout : [];
  const pages = layout.length;
  let sections = 0;
  let subsections = 0;
  layout.forEach((page) => {
    const secs = Array.isArray(page?.sections) ? page.sections : [];
    sections += secs.length;
    secs.forEach((sec) => {
      subsections += Array.isArray(sec?.subsections) ? sec.subsections.length : 0;
    });
  });
  return { pages, sections, subsections };
}

function outlinePreviewData(template) {
  const layout = Array.isArray(template?.layout) ? template.layout : [];
  return layout.map((page, pi) => ({
    key: `page-${pi}`,
    label: `${pi + 1}. ${page?.pageTitle || "Untitled page"}`,
    sections: (page?.sections || []).map((sec, si) => ({
      key: `sec-${pi}-${si}`,
      label: `${pi + 1}.${si + 1} ${sec?.heading || "Untitled section"}`,
      subsections: (sec?.subsections || []).map((sub, xi) => ({
        key: `sub-${pi}-${si}-${xi}`,
        label: `${pi + 1}.${si + 1}.${xi + 1} ${sub?.title || "Untitled subheading"}`,
        meta: `${sub?.chart?.type || "none"} • rows ${sub?.table?.rowLimit || 12} • cols ${(sub?.table?.columns || []).length}`,
      })),
    })),
  }));
}

function templatePreviewWireframe(template) {
  const layout = Array.isArray(template?.layout) ? template.layout : [];
  if (!layout.length) {
    return [{ title: "No pages yet", rows: [] }];
  }

  return layout.map((page) => {
    const rows = [];
    (page?.sections || []).forEach((sec) => {
      rows.push({ type: "section", label: sec?.heading || "Untitled section" });
      (sec?.subsections || []).forEach((sub) => {
        rows.push({
          type: "sub",
          label: sub?.title || "Untitled subheading",
          chart: sub?.chart?.type || "none",
          cols: (sub?.table?.columns || []).length,
        });
      });
    });
    return {
      title: page?.pageTitle || "Untitled page",
      rows,
    };
  });
}

function buildDefaultPrebookTemplate({ questions, brief }) {
  const now = nowIso();
  return {
    id: "default_prebook_template",
    name: "Standard Default",
    targetAudience: brief?.audience || "",
    description: "Fallback default template derived from the current built-in pre-book report structure.",
    version: 1,
    createdAt: now,
    updatedAt: now,
    layout: [
      {
        pageTitle: "Objective & Scope",
        sections: [
          {
            heading: "Objective & Scope",
            subsections: [
              {
                title: "Report Objective",
                chart: { type: "none", notes: "" },
                table: { columns: [], rowLimit: 12 },
                bodyNotes: brief?.objective || "No objective provided.",
              },
              {
                title: "Audience & Coverage",
                chart: { type: "none", notes: "" },
                table: { columns: [], rowLimit: 12 },
                bodyNotes: `Audience: ${brief?.audience || "-"}\nGeography: ${brief?.geography || "-"}\nTime Horizon: ${brief?.horizon || "-"}\nDepth: ${brief?.depth || "-"}\nTone: ${brief?.tone || "-"}`,
              },
            ],
          },
        ],
      },
      {
        pageTitle: "Research Questions",
        sections: [
          {
            heading: "Research Questions",
            subsections: (questions || [])
              .filter((q) => q.trim())
              .map((q, i) => ({
                title: `Question ${i + 1}`,
                chart: { type: "none", notes: "" },
                table: { columns: [], rowLimit: 12 },
                bodyNotes: q,
              })),
          },
        ],
      },
      {
        pageTitle: "Special Instructions",
        sections: [
          {
            heading: "Special Instructions",
            subsections: [
              {
                title: "Must Include",
                chart: { type: "none", notes: "" },
                table: { columns: [], rowLimit: 12 },
                bodyNotes: brief?.mustInclude || "No must-include instructions provided.",
              },
              {
                title: "Avoid / Special Notes",
                chart: { type: "none", notes: "" },
                table: { columns: [], rowLimit: 12 },
                bodyNotes: brief?.avoidNotes || "No avoid notes provided.",
              },
            ],
          },
        ],
      },
    ],
  };
}

function buildPrebookPromptTips({ topic, questions, brief, activeTemplate }) {
  const tips = [];
  if (!topic.trim()) tips.push("Add a precise topic.");
  if (questions.filter((q) => q.trim()).length < 5) tips.push("Fill all five research questions.");
  if (!brief.objective.trim()) tips.push("Add a report objective.");
  if (!brief.audience.trim()) tips.push("Specify the target audience.");
  if (!brief.mustInclude.trim()) tips.push("Add must-include metrics or sections.");
  if (!activeTemplate) tips.push("Use a saved template if you want stronger structure control.");
  if (!tips.length) tips.push("This brief is strong enough for a fine-grained Pre-book report.");
  return tips;
}

function formatDateGroupLabel(dateKey) {
  if (!dateKey) return "Unknown date";
  const d = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateKey;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getDateKey(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return "unknown-date";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function groupHistoryByDate(items) {
  const groupsMap = new Map();

  [...(items || [])]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .forEach((item) => {
      const dateKey = getDateKey(item.createdAt);
      if (!groupsMap.has(dateKey)) {
        groupsMap.set(dateKey, []);
      }
      groupsMap.get(dateKey).push(item);
    });

  return Array.from(groupsMap.entries()).map(([dateKey, items]) => ({
    dateKey,
    label: formatDateGroupLabel(dateKey),
    items,
  }));
}

export default function App() {
  const CONFIRM_API = import.meta.env.VITE_CONFIRM_API;
  const STATUS_API = import.meta.env.VITE_STATUS_API;
  const PRESIGN_API = import.meta.env.VITE_PRESIGN_API;

  const PREBOOK_QUOTA_API = import.meta.env.VITE_PREBOOK_QUOTA_API;
  const PREBOOK_GENERATE_API = import.meta.env.VITE_PREBOOK_GENERATE_API;
  const PREBOOK_STATUS_API = import.meta.env.VITE_PREBOOK_STATUS_API;
  const PREBOOK_PRESIGN_API = import.meta.env.VITE_PREBOOK_PRESIGN_API || PRESIGN_API;
  const PREBOOK_PUBLISH_API = "https://jp1bupouyl.execute-api.ap-south-1.amazonaws.com/prod/prebook/publish";
  const CATALOG_API = import.meta.env.VITE_CATALOG_API || "https://example.com/rbr/catalog/list";
  const SUGGEST_API = "https://vtwyu7hv50.execute-api.ap-south-1.amazonaws.com/default/suggest";
  const SUGGEST_PREVIEW_API = "https://vtwyu7hv50.execute-api.ap-south-1.amazonaws.com/default/RBR_report_pre-signed_URL";

  const [publishingIds, setPublishingIds] = useState({});
  const [topic, setTopic] = useState("FMCG market report India");
  const [questions, setQuestions] = useState(DEFAULT_QUESTIONS);
  const [activeTab, setActiveTab] = useState("instant");
  const isPrebook = activeTab === "prebook";
  const isCatalog = activeTab === "catalog";

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

  const [prebookTopic, setPrebookTopic] = useState("FMCG market report India");
  const [prebookQuestions, setPrebookQuestions] = useState(DEFAULT_QUESTIONS);
  const [prebookBrief, setPrebookBrief] = useState(DEFAULT_PREBOOK_BRIEF);

  const [prebookTemplates, setPrebookTemplates] = useState(() => loadPrebookTemplates());
  const [activePrebookTemplateId, setActivePrebookTemplateId] = useState(() =>
    loadActivePrebookTemplateId()
  );

  const activePrebookTemplate = useMemo(() => {
    return prebookTemplates.find((t) => t.id === activePrebookTemplateId) || null;
  }, [prebookTemplates, activePrebookTemplateId]);

  const defaultPrebookTemplate = useMemo(() => {
    return buildDefaultPrebookTemplate({
      questions: prebookQuestions,
      brief: prebookBrief,
    });
  }, [prebookQuestions, prebookBrief]);

  const selectedOrDefaultPrebookTemplate = useMemo(() => {
    return activePrebookTemplate ? deepClone(activePrebookTemplate) : deepClone(defaultPrebookTemplate);
  }, [activePrebookTemplate, defaultPrebookTemplate]);

  const [tplModalOpen, setTplModalOpen] = useState(false);
  const [tplMode, setTplMode] = useState("edit");
  const [tplDraft, setTplDraft] = useState(null);
  const [tplShowPreview, setTplShowPreview] = useState(true);
  const tplImportInputRef = useRef(null);

  const [quota, setQuota] = useState({ limit: 0, used: 0, remaining: 0 });
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [quotaError, setQuotaError] = useState("");

  const [loading, setLoading] = useState(false);
  const [prebookLoading, setPrebookLoading] = useState(false);
  const [error, setError] = useState("");

  function toggleDateGroup(dateKey) {
    setExpandedDateGroups((prev) => ({
      ...prev,
      [dateKey]: prev[dateKey] !== undefined ? !prev[dateKey] : true,
    }));
  }

  function ensurePrebookQuotaEnv() {
    if (!PREBOOK_QUOTA_API) {
      setError("Missing env var: VITE_PREBOOK_QUOTA_API. Add it in Amplify env vars and redeploy.");
      return false;
    }
    return true;
  }

  const [lastApiResponse, setLastApiResponse] = useState(null);

  const [history, setHistory] = useState(() => loadHistory());
  const [leftId, setLeftId] = useState(null);
  const [rightId, setRightId] = useState(null);

  const [prebookHistory, setPrebookHistory] = useState(() => loadPrebookHistory());
  const [preLeftId, setPreLeftId] = useState(null);
  const [preRightId, setPreRightId] = useState(null);
  const [leftHidden, setLeftHidden] = useState(false);

  const [historyQuery, setHistoryQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [catalogItems, setCatalogItems] = useState([]);
  const [catalogMeta, setCatalogMeta] = useState({ total: 0, source: "" });
  const [suggestTesterQuery, setSuggestTesterQuery] = useState("");
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState("");
  const [suggestResults, setSuggestResults] = useState([]);
  const [toast, setToast] = useState("");
  const [showDebug, setShowDebug] = useState(false);
  const [expandedDateGroups, setExpandedDateGroups] = useState({});

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
    } catch {}

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
    const sorted = [...history].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const first = sorted[0]?.id ?? null;
    const second = sorted[1]?.id ?? null;
    setLeftId((prev) => prev ?? first);
    setRightId((prev) => prev ?? second ?? first);
  }, [history]);

  useEffect(() => {
    if (!prebookHistory.length) return;
    const sorted = [...prebookHistory].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
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
  if (!PREBOOK_STATUS_API) return;
  if (!prebookHistory.length) return;

  let cancelled = false;

  const tick = async () => {
    const pendingItems = prebookHistory.filter((item) => {
      const st = prettyStatus(item.status);
      return item?.reportId && !["completed", "done", "failed"].includes(st);
    });

    for (const item of pendingItems) {
      if (cancelled) return;
      try {
        await refreshPrebookItem(item);
      } catch {
        // silent on purpose
      }
    }
  };

  tick();
  const id = setInterval(tick, 4000);

  return () => {
    cancelled = true;
    clearInterval(id);
  };
}, [PREBOOK_STATUS_API, prebookHistory]);

  useEffect(() => {
    if (activeTab !== "catalog") return;
    loadCatalog();
  }, [activeTab]);

  const activeHistory = activeTab === "instant" ? history : activeTab === "prebook" ? prebookHistory : [];
  const leftSelId = activeTab === "instant" ? leftId : activeTab === "prebook" ? preLeftId : null;
  const rightSelId = activeTab === "instant" ? rightId : activeTab === "prebook" ? preRightId : null;

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

  const groupedFilteredHistory = useMemo(() => {
    return groupHistoryByDate(filteredHistory);
  }, [filteredHistory]);

  const activeTemplateStats = useMemo(
    () => templateStats(selectedOrDefaultPrebookTemplate),
    [selectedOrDefaultPrebookTemplate]
  );
  const activeTemplateOutline = useMemo(
    () => outlinePreviewData(selectedOrDefaultPrebookTemplate),
    [selectedOrDefaultPrebookTemplate]
  );
  const tplDraftWireframe = useMemo(() => templatePreviewWireframe(tplDraft), [tplDraft]);

  const prebookPromptStrength = useMemo(() => {
    let score = 0;
    if (prebookTopic.trim()) score += 20;
    if (prebookQuestions.filter((q) => q.trim()).length === 5) score += 25;
    if (prebookBrief.objective.trim()) score += 10;
    if (prebookBrief.audience.trim()) score += 10;
    if (prebookBrief.mustInclude.trim()) score += 10;
    if (activePrebookTemplate) score += 15;
    if (["detailed", "expert"].includes(prebookBrief.depth)) score += 10;
    return Math.min(score, 100);
  }, [prebookTopic, prebookQuestions, prebookBrief, activePrebookTemplate]);

  const promptStrengthLabel =
    prebookPromptStrength >= 85
      ? "Excellent"
      : prebookPromptStrength >= 65
      ? "Strong"
      : prebookPromptStrength >= 45
      ? "Good"
      : "Needs more detail";

  const promptStrengthTips = useMemo(
    () =>
      buildPrebookPromptTips({
        topic: prebookTopic,
        questions: prebookQuestions,
        brief: prebookBrief,
        activeTemplate: activePrebookTemplate,
      }),
    [prebookTopic, prebookQuestions, prebookBrief, activePrebookTemplate]
  );

  function updateQuestion(i, val) {
    setQuestions((prev) => prev.map((q, idx) => (idx === i ? val : q)));
  }

  function updatePrebookQuestion(i, val) {
    setPrebookQuestions((prev) => prev.map((q, idx) => (idx === i ? val : q)));
  }

  function updatePrebookBrief(key, value) {
    setPrebookBrief((prev) => ({ ...prev, [key]: value }));
  }

  function ensureEnv() {
    const missing = [];
    if (!CONFIRM_API) missing.push("VITE_CONFIRM_API");
    if (!STATUS_API) missing.push("VITE_STATUS_API");
    if (!PRESIGN_API) missing.push("VITE_PRESIGN_API");
    if (missing.length) {
      setError(`Missing env var(s): ${missing.join(", ")}. Add them in Amplify env vars and redeploy.`);
      return false;
    }
    return true;
  }

  function ensurePrebookEnv() {
    const missing = [];
    if (!PREBOOK_QUOTA_API) missing.push("VITE_PREBOOK_QUOTA_API");
    if (!PREBOOK_GENERATE_API) missing.push("VITE_PREBOOK_GENERATE_API");
    if (!PREBOOK_STATUS_API) missing.push("VITE_PREBOOK_STATUS_API");
    if (missing.length) {
      setError(`Missing env var(s): ${missing.join(", ")}. Add them in Amplify env vars and redeploy.`);
      return false;
    }
    return true;
  }

  async function sendPrebookToProduction(item) {
    if (!PREBOOK_PUBLISH_API) {
      setError("Missing env var: VITE_PREBOOK_PUBLISH_API");
      return;
    }

    if (!item?.reportId) {
      setError("Missing reportId for this pre-book report.");
      return;
    }

    const status = prettyStatus(item.status);
    if (!["completed", "done"].includes(status)) {
      setToast(`Only completed reports can be sent to production. Current status: ${status}`);
      return;
    }

    setPublishingIds((prev) => ({ ...prev, [item.id]: true }));

    try {
      const resolvedS3Key =
        item.s3Key ||
        item.pdfKey ||
        item?.raw?.s3Key ||
        item?.raw?.pdfKey ||
        item?.raw?.s3_key ||
        item?.raw?.pdf_key ||
        "";

      if (!resolvedS3Key) {
        throw new Error("Missing s3Key/pdfKey for this pre-book report.");
      }

      const payload = {
        reportId: item.reportId,
        reportName: item.reportName || item.title || item.topic || "Untitled Report",
        topic: item.topic || item.reportName || item.title || "Untitled Report",
        s3Key: resolvedS3Key,
      };

      console.log("SEND TO PRODUCTION ITEM =", item);
      console.log("SEND TO PRODUCTION PAYLOAD =", payload);

      const res = await fetch(PREBOOK_PUBLISH_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const text = await res.text();

      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }

      console.log("SEND TO PRODUCTION STATUS =", res.status);
      console.log("SEND TO PRODUCTION RESPONSE TEXT =", text);
      console.log("SEND TO PRODUCTION RESPONSE DATA =", data);

      if (!res.ok || !data?.ok) {
        throw new Error(
          data?.error ||
            data?.message ||
            text ||
            "Send to Production failed"
        );
      }

      upsertPrebookItem(item.id, {
        productionStatus: data.productionStatus || "published",
        productionSlug: data.slug || "",
        productionFullKey: data.full_key || "",
        productionPreviewKey: data.preview_key || "",
        sentToProductionAt: data.sentAt || nowIso(),
        raw: {
          ...(item.raw || {}),
          production: data,
        },
      });

      setToast("Sent to Production ✅");
    } catch (e) {
      console.error("SEND TO PRODUCTION ERROR =", e);
      setError(e?.message || "Send to Production failed");
      setToast("Send to Production failed");
    } finally {
      setPublishingIds((prev) => ({ ...prev, [item.id]: false }));
    }
  }

  
  async function loadQuota() {
    setQuotaError("");
    if (!ensurePrebookQuotaEnv()) return;

    setQuotaLoading(true);
    try {
      const { res, data } = await fetchJson(PREBOOK_QUOTA_API, { method: "GET" });
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

  function persistTemplates(list, activeId) {
    const next = Array.isArray(list) ? list : [];
    setPrebookTemplates(next);
    savePrebookTemplates(next);
    const id = activeId || "";
    setActivePrebookTemplateId(id);
    saveActivePrebookTemplateId(id);
  }

  function openNewTemplate() {
    setTplMode("new");
    setTplDraft(makeEmptyTemplate());
    setTplShowPreview(true);
    setTplModalOpen(true);
  }

  function openEditTemplate() {
    if (!activePrebookTemplate) {
      openNewTemplate();
      return;
    }
    setTplMode("edit");
    setTplDraft(deepClone(activePrebookTemplate));
    setTplShowPreview(true);
    setTplModalOpen(true);
  }

  function openSaveAsTemplate() {
    const base = activePrebookTemplate ? deepClone(activePrebookTemplate) : makeEmptyTemplate();
    base.id = makeTemplateId();
    base.createdAt = nowIso();
    base.updatedAt = nowIso();
    base.version = 1;
    base.name = base.name ? `${base.name} (copy)` : "";
    setTplMode("saveas");
    setTplDraft(base);
    setTplShowPreview(true);
    setTplModalOpen(true);
  }

  function deleteActiveTemplate() {
    if (!activePrebookTemplateId) return;
    const next = prebookTemplates.filter((t) => t.id !== activePrebookTemplateId);
    persistTemplates(next, next[0]?.id || "");
    setToast("Template deleted");
  }

  function selectTemplate(id) {
    const tid = id || "";
    setActivePrebookTemplateId(tid);
    saveActivePrebookTemplateId(tid);
  }

  function saveTemplateDraft() {
    if (!tplDraft) return;
    const name = (tplDraft.name || "").trim();
    if (!name) {
      setToast("Template name required");
      return;
    }

    const now = nowIso();
    const nextTpl = { ...tplDraft, name, updatedAt: now };
    const list = loadPrebookTemplates();
    const idx = list.findIndex((t) => t.id === nextTpl.id);

    const finalTpl =
      idx >= 0 ? { ...list[idx], ...nextTpl } : { ...nextTpl, createdAt: nextTpl.createdAt || now };

    const nextList =
      idx >= 0 ? list.map((t) => (t.id === finalTpl.id ? finalTpl : t)) : [finalTpl, ...list];

    persistTemplates(nextList.slice(0, 200), finalTpl.id);
    setTplModalOpen(false);
    setToast("Template saved ✅");
  }

  function exportPrebookTemplates() {
    try {
      const payload = {
        exportVersion: 1,
        exportedAt: nowIso(),
        templates: loadPrebookTemplates(),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rbr_prebook_templates_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setToast("Templates exported ✅");
    } catch {
      setToast("Export failed");
    }
  }

  async function importPrebookTemplatesFromFile(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const imported = Array.isArray(parsed) ? parsed : parsed?.templates;
      if (!Array.isArray(imported)) {
        setToast("Invalid template file");
        return;
      }
      const next = imported
        .filter((t) => t && typeof t === "object" && typeof t.id === "string")
        .slice(0, 200)
        .map((t) => ({
          ...t,
          updatedAt: t.updatedAt || nowIso(),
          createdAt: t.createdAt || nowIso(),
          version: Number.isFinite(t.version) ? t.version : 1,
          layout: Array.isArray(t.layout) ? t.layout : [],
        }));
      persistTemplates(next, next[0]?.id || "");
      setToast(`Imported ${next.length} template(s) ✅`);
    } catch {
      setToast("Import failed");
    } finally {
      if (tplImportInputRef.current) tplImportInputRef.current.value = "";
    }
  }

  function triggerImportTemplates() {
    tplImportInputRef.current?.click();
  }

  function upsertHistoryItem(id, patch) {
    setHistory((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function upsertPrebookItem(id, patch) {
    setPrebookHistory((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  async function fetchPrebookStatus(reportId) {
  if (!PREBOOK_STATUS_API) {
    throw new Error("Missing env var: VITE_PREBOOK_STATUS_API");
  }
  if (!reportId) {
    throw new Error("Missing reportId for pre-book status check");
  }

  const url = new URL(PREBOOK_STATUS_API);
  url.searchParams.set("reportId", reportId);

  const { res, data } = await fetchJson(url.toString(), {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok || !data?.ok) {
    throw new Error(buildErrorMessage(res, data, "Pre-book status check failed"));
  }

  return data;
}

  async function refreshPrebookItem(itemOrId) {
    const item =
      typeof itemOrId === "string"
        ? prebookHistory.find((x) => x.id === itemOrId) || null
        : itemOrId || null;
  
    if (!item) return null;
    if (!item.reportId) return item;
  
    const statusData = await fetchPrebookStatus(item.reportId);
  
    const nextItem = {
      ...item,
      reportId: statusData.reportId || item.reportId,
      reportName: statusData.reportName || item.reportName || item.title,
      title: statusData.reportName || item.title || item.reportName,
      topic: statusData.topic || item.topic,
      status: statusData.status || item.status || "unknown",
      s3Key: statusData.s3Key || statusData.pdfKey || item.s3Key || item.pdfKey || "",
      pdfKey: statusData.pdfKey || statusData.s3Key || item.pdfKey || item.s3Key || "",
      pdfUrl: statusData.pdfUrl || item.pdfUrl || "",
      raw: statusData,
    };
  
    // IMPORTANT: always persist the latest status first
    upsertPrebookItem(item.id, nextItem);
  
    if (["completed", "done"].includes(prettyStatus(nextItem.status))) {
      const refreshed = await ensurePrebookPdfUrl(nextItem);
  
      const finalItem = {
        ...nextItem,
        pdfUrl: refreshed?.pdfUrl || nextItem.pdfUrl || "",
        s3Key: refreshed?.s3Key || refreshed?.pdfKey || nextItem.s3Key || nextItem.pdfKey || "",
        pdfKey: refreshed?.pdfKey || refreshed?.s3Key || nextItem.pdfKey || nextItem.s3Key || "",
      };
  
      // IMPORTANT: persist again after presign refresh
      upsertPrebookItem(item.id, finalItem);
      return finalItem;
    }
  
    return nextItem;
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

      throw new Error(`Still running after ${Math.round(MAX_WAIT_MS / 1000)}s. Please wait and try again.`);
    } finally {
      clearInterval(timer);
    }
  }

  async function pollPrebookStatusUntilDone({ reportId, historyId }) {
    const startedAt = Date.now();
    pollAbortRef.current.aborted = false;
  
    setModalOpen(true);
    setModalTitle("Generating pre-book report…");
    setModalSub("Queued • waiting for worker");
    setProgressPct(8);
  
    const timer = setInterval(() => {
      if (!mountedRef.current) return;
      setProgressPct((p) => (p >= 92 ? p : Math.min(92, p + 1)));
    }, 900);
  
    try {
      while (Date.now() - startedAt < MAX_WAIT_MS) {
        if (!mountedRef.current) throw new Error("Page closed");
        if (pollAbortRef.current.aborted) throw new Error("Polling aborted");
  
        let data = null;
        let pollError = null;
  
        try {
          data = await fetchPrebookStatus(reportId);
        } catch (e) {
          pollError = e;
        }
  
        if (!mountedRef.current) throw new Error("Page closed");
  
        // IMPORTANT:
        // During the first ~20 seconds, a 404 / not-found can simply mean
        // the worker has not yet written the DynamoDB item.
        if (pollError) {
          const msg = String(pollError?.message || "").toLowerCase();
          const isNotReadyYet =
            msg.includes("404") ||
            msg.includes("not found") ||
            msg.includes("report job not found");
  
          if (isNotReadyYet && Date.now() - startedAt < 20000) {
            setModalSub("Queued • waiting for worker");
            await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
            continue;
          }
  
          throw pollError;
        }
  
        setLastApiResponse(data);
  
        const status = prettyStatus(data?.status);
        const errMsg = data?.errorMessage || data?.error || data?.details || "";
  
        upsertPrebookItem(historyId, {
          reportId: data?.reportId || reportId,
          reportName: data?.reportName || undefined,
          title: data?.reportName || undefined,
          status: data?.status || "unknown",
          s3Key: data?.s3Key || data?.pdfKey || "",
          pdfKey: data?.pdfKey || data?.s3Key || "",
          raw: data,
        });
  
        if (["completed", "done"].includes(status)) {
          setModalSub("Ready");
          setProgressPct(95);
          return data;
        }
  
        if (status === "failed") {
          throw new Error(errMsg || "Pre-book report failed");
        }
  
        setModalSub(
          status === "rendering_pdf"
            ? "Rendering PDF • almost done"
            : status === "json_ready"
            ? "Content ready • preparing PDF"
            : status === "generating"
            ? "Generating content • researching + drafting"
            : "Queued • waiting for worker"
        );
  
        await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
      }
  
      throw new Error(
        `Pre-book report is still running after ${Math.round(MAX_WAIT_MS / 1000)}s. Please check again shortly.`
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
    if (data?.ok === false) throw new Error(buildErrorMessage(res, data, "Presign failed"));

    const u = data?.presignedUrl || data?.presigned_url || data?.url || data?.presignedURL || "";
    if (!u) throw new Error("Presign API returned no URL");
    return u;
  }

  async function ensurePrebookPdfUrl(item) {
    if (!item) return item;

    if (!PREBOOK_PRESIGN_API) {
      throw new Error("Missing env var: VITE_PREBOOK_PRESIGN_API");
    }
    
    const status = prettyStatus(item.status);
    if (!["completed", "done"].includes(status)) {
      throw new Error(`This pre-book report is still ${status}.`);
    }
    
    if (!item.s3Key && !item.reportId) {
      throw new Error("No s3Key/reportId available for this pre-book report.");
    }

    const url = new URL(PREBOOK_PRESIGN_API);

    if (item.s3Key) url.searchParams.set("s3Key", item.s3Key);
    if (item.reportId) url.searchParams.set("reportId", item.reportId);

    const { res, data } = await fetchJson(url.toString(), {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok || data?.ok === false) {
      throw new Error(buildErrorMessage(res, data, "Pre-book presign failed"));
    }

    const presignedUrl =
      data?.presignedUrl || data?.presigned_url || data?.url || data?.presignedURL || "";

    if (!presignedUrl) {
      throw new Error("Pre-book presign API returned no URL");
    }

    const freshUrl = withFragmentBuster(presignedUrl);

    upsertPrebookItem(item.id, {
      pdfUrl: freshUrl,
      s3Key: data?.s3Key || data?.pdfKey || item.s3Key || item.pdfKey || "",
      pdfKey: data?.pdfKey || data?.s3Key || item.pdfKey || item.s3Key || "",
    });

    return {
      ...item,
      pdfUrl: freshUrl,
      s3Key: data?.s3Key || data?.pdfKey || item.s3Key || item.pdfKey || "",
      pdfKey: data?.pdfKey || data?.s3Key || item.pdfKey || item.s3Key || "",
    };
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

      const statusData = await pollStatusUntilDone({ userPhone, instantId, historyId });
      if (!statusData || !mountedRef.current) return;

      const finalS3Key =
        statusData?.s3Key || statusData?.s3_key || `instant/${userPhone}/${instantId}.pdf`;

      const presignedUrl = await getPresignedUrl({ userPhone, instantId, s3Key: finalS3Key });
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

  async function generatePrebook() {
    setError("");
    setQuotaError("");
    setLastApiResponse(null);

    if (!ensurePrebookEnv()) return;

    const t = prebookTopic.trim();
    const qs = prebookQuestions.map((q) => (q || "").trim());
    const generationTimestamp = formatReportTimestamp();
    const reportDisplayName = `${t} — ${generationTimestamp}`;

    if (!t) return setError("Please enter a topic.");
    if (qs.some((q) => !q)) return setError("Please fill all 5 questions.");
    if ((quota?.remaining ?? 0) <= 0) {
      return setError("Daily Pre-book limit reached. Try again tomorrow.");
    }

    setPrebookLoading(true);

    let historyId = "";

    try {
      const templateToSend = deepClone(selectedOrDefaultPrebookTemplate);
      const isDefaultTemplate = !activePrebookTemplate;

      const payload = {
        topic: t,
        reportName: reportDisplayName,
        questions: qs,
        brief: deepClone(prebookBrief),
        template: templateToSend,
        templateMeta: {
          templateId: templateToSend?.id || "default_prebook_template",
          templateName: templateToSend?.name || "Standard Default",
          isDefault: isDefaultTemplate,
        },

        // kept for backward compatibility with your current backend
        report: {
          title: reportDisplayName || "RBR Pre-book Report",
          subtitle: `${prebookBrief.audience || "General audience"} • ${prebookBrief.geography || "India"} • ${prebookBrief.horizon || "3-5 years"}`,
          sections: [
            {
              heading: "Objective & Scope",
              subheadings: [
                {
                  title: "Report Objective",
                  content: prebookBrief.objective || "No objective provided.",
                  charts: [],
                  tables: [],
                },
                {
                  title: "Audience & Coverage",
                  content: `Audience: ${prebookBrief.audience || "-"}\nGeography: ${prebookBrief.geography || "-"}\nTime Horizon: ${prebookBrief.horizon || "-"}\nDepth: ${prebookBrief.depth || "-"}\nTone: ${prebookBrief.tone || "-"}`,
                  charts: [],
                  tables: [],
                },
              ],
            },
            {
              heading: "Research Questions",
              subheadings: prebookQuestions
                .filter((q) => q.trim())
                .map((q, i) => ({
                  title: `Question ${i + 1}`,
                  content: q,
                  charts: [],
                  tables: [],
                })),
            },
            {
              heading: "Special Instructions",
              subheadings: [
                {
                  title: "Must Include",
                  content: prebookBrief.mustInclude || "No must-include instructions provided.",
                  charts: [],
                  tables: [],
                },
                {
                  title: "Avoid / Special Notes",
                  content: prebookBrief.avoidNotes || "No avoid notes provided.",
                  charts: [],
                  tables: [],
                },
              ],
            },
          ],
        },
      };

      historyId = `prebook-${Date.now()}`;
      const newItem = {
        id: historyId,
        createdAt: nowIso(),
        topic: t,
        reportName: reportDisplayName,
        title: reportDisplayName,
        templateId: templateToSend?.id || "default_prebook_template",
        templateName: templateToSend?.name || "Standard Default",
        brief: deepClone(prebookBrief),
        reportId: "",
        status: "queued",
        pdfUrl: "",
        s3Key: "",
        raw: null,
      };

      setPrebookHistory((prev) => [newItem, ...prev].slice(0, 200));

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
      const s3Key = data.s3Key || data.s3_key || data.pdfKey || data.pdf_key || "";
      
      upsertPrebookItem(historyId, {
        reportName: data.reportName || data.report_name || data.title || reportDisplayName,
        title: data.title || reportDisplayName,
        reportId,
        status: data.status || "queued",
        s3Key,
        pdfKey: data.pdfKey || data.pdf_key || s3Key,
        pdfUrl: "",
        raw: data,
      });
      
      if (!reportId) {
        throw new Error("Pre-book generate API did not return reportId");
      }
      
      setModalOpen(true);
      setModalTitle("Generating pre-book report…");
      setModalSub("Queued • waiting for worker");
      setProgressPct(10);
      
      await loadQuota();
      setToast("Pre-book generation started ✅");
      
      const statusData = await pollPrebookStatusUntilDone({ reportId, historyId });
      if (!statusData || !mountedRef.current) return;
      
      const finalItem = {
        id: historyId,
        reportId: statusData.reportId || reportId,
        status: statusData.status || "completed",
        s3Key: statusData.s3Key || statusData.pdfKey || "",
        pdfKey: statusData.pdfKey || statusData.s3Key || "",
      };
      
      let freshPdfUrl = "";
      if (
        prettyStatus(statusData.status) === "completed" ||
        prettyStatus(statusData.status) === "done"
      ) {
        const refreshed = await ensurePrebookPdfUrl({
          ...finalItem,
          reportId: statusData.reportId || reportId,
          status: statusData.status || "completed",
          s3Key: statusData.s3Key || statusData.pdfKey || finalItem.s3Key || finalItem.pdfKey || "",
          pdfKey: statusData.pdfKey || statusData.s3Key || finalItem.pdfKey || finalItem.s3Key || "",
        });
        freshPdfUrl = refreshed?.pdfUrl || "";
      }
      
      upsertPrebookItem(historyId, {
        reportName: statusData.reportName || reportDisplayName,
        title: statusData.reportName || reportDisplayName,
        reportId: statusData.reportId || reportId,
        status: statusData.status || "completed",
        s3Key: statusData.s3Key || statusData.pdfKey || "",
        pdfKey: statusData.pdfKey || statusData.s3Key || "",
        pdfUrl: freshPdfUrl || "",
        raw: statusData,
      });
      
      setModalSub("Ready");
      setProgressPct(100);
      setTimeout(() => mountedRef.current && setModalOpen(false), 550);
      setToast("Pre-book report generated ✅");
    } catch (e) {
      const msg = e?.message || "Pre-book generation failed";
      setError(msg);
      setToast("Pre-book generation failed");
    
      if (historyId) {
        upsertPrebookItem(historyId, {
          status: "failed",
          raw: { error: msg },
        });
      }
    } finally {
      setPrebookLoading(false);
    }
  }

  async function setLeft(itemId) {
  if (activeTab === "instant") {
    setLeftId(itemId);
    if (itemId === rightId) {
      const alt = history.find((x) => x.id !== itemId)?.id || itemId;
      setRightId(alt);
    }
    return;
  }

  try {
    const item = prebookHistory.find((x) => x.id === itemId);

    if (item) {
      const refreshed = await refreshPrebookItem(item);
      const status = prettyStatus(refreshed?.status || item.status);

      if (!["completed", "done"].includes(status) && status !== "failed") {
        setToast(`This pre-book report is still ${status}.`);
      } else if (status === "failed") {
        throw new Error("This pre-book report failed.");
      }
    }

    setPreLeftId(itemId);

    if (itemId === preRightId) {
      const alt = prebookHistory.find((x) => x.id !== itemId)?.id || itemId;
      setPreRightId(alt);
    }
  } catch (e) {
    setError(e?.message || "Could not open pre-book PDF");
  }
}

  async function setRight(itemId) {
  if (activeTab === "instant") {
    setRightId(itemId);
    if (itemId === leftId) {
      const alt = history.find((x) => x.id !== itemId)?.id || itemId;
      setLeftId(alt);
    }
    return;
  }

  try {
    const item = prebookHistory.find((x) => x.id === itemId);

    if (item) {
      const refreshed = await refreshPrebookItem(item);
      const status = prettyStatus(refreshed?.status || item.status);

      if (!["completed", "done"].includes(status) && status !== "failed") {
        setToast(`This pre-book report is still ${status}.`);
      } else if (status === "failed") {
        throw new Error("This pre-book report failed.");
      }
    }

    setPreRightId(itemId);

    if (itemId === preLeftId) {
      const alt = prebookHistory.find((x) => x.id !== itemId)?.id || itemId;
      setPreLeftId(alt);
    }
  } catch (e) {
    setError(e?.message || "Could not open pre-book PDF");
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

  function normalizeCatalogItems(payload) {
    const rawItems = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload?.data)
      ? payload.data
      : [];

    return rawItems.map((item, index) => ({
      id: item?.id || item?.reportId || item?.slug || item?.title || `catalog-${index}` ,
      title: item?.title || item?.reportName || item?.topic || "Untitled report",
      slug: item?.slug || item?.reportSlug || "",
      full_key: item?.full_key || item?.fullKey || item?.file_key || item?.fileKey || "",
      preview_key: item?.preview_key || item?.previewKey || item?.preview_file_key || "",
      reportId: item?.reportId || item?.report_id || "",
      topic: item?.topic || "",
      keywords: Array.isArray(item?.keywords) ? item.keywords : [],
      sentAt: item?.sentAt || item?.publishedAt || item?.createdAt || item?.updatedAt || "",
      raw: item,
    }));
  }

  function normalizeSuggestResults(payload) {
    const rawItems = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.suggestions)
      ? payload.suggestions
      : Array.isArray(payload?.results)
      ? payload.results
      : [];

    return rawItems.map((item, index) => ({
      id: item?.id || item?.slug || item?.title || item?.name || `suggest-${index}` ,
      title: item?.title || item?.name || item?.reportName || item?.topic || "Untitled suggestion",
      slug: item?.slug || item?.reportSlug || "",
      preview_key: item?.preview_key || item?.previewKey || item?.file_key || item?.fileKey || "",
      full_key: item?.full_key || item?.fullKey || "",
      keywords: Array.isArray(item?.keywords) ? item.keywords : [],
      raw: item,
    }));
  }

  async function loadCatalog(searchTerm = catalogSearch) {
    setCatalogLoading(true);
    setCatalogError("");
    try {
      const payload = {
        query: String(searchTerm || "").trim(),
        limit: 100,
      };

      const { res, data } = await fetchJson(CATALOG_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(buildErrorMessage(res, data, "Catalog API failed"));
      }

      const items = normalizeCatalogItems(data);
      setCatalogItems(items);
      setCatalogMeta({
        total: Number(data?.total || items.length || 0),
        source: data?.source || "catalog_api",
      });
    } catch (e) {
      setCatalogItems([]);
      setCatalogMeta({ total: 0, source: "" });
      setCatalogError(e?.message || "Failed to load catalog");
    } finally {
      setCatalogLoading(false);
    }
  }

  async function runSuggestionTest(queryOverride) {
    const q = String(queryOverride ?? suggestTesterQuery ?? "").trim();
    setSuggestTesterQuery(q);

    if (!q) {
      setSuggestResults([]);
      setSuggestError("Please enter a query to test suggestions.");
      return;
    }

    setSuggestLoading(true);
    setSuggestError("");
    try {
      const { res, data } = await fetchJson(SUGGEST_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q, limit: 3 }),
      });

      if (!res.ok) {
        throw new Error(buildErrorMessage(res, data, "Suggest API failed"));
      }

      const parsed = (data && typeof data.body === "string") ? JSON.parse(data.body) : data;
      const items = normalizeSuggestResults(parsed);
      setSuggestResults(items);
      if (!items.length && parsed?.hint) {
        setSuggestError(parsed.hint);
      }
    } catch (e) {
      setSuggestResults([]);
      setSuggestError(e?.message || "Failed to fetch suggestions");
    } finally {
      setSuggestLoading(false);
    }
  }

  async function openCatalogPreview(item) {
    const previewKey = item?.preview_key || item?.raw?.preview_key || item?.raw?.previewKey || "";
    if (!previewKey) {
      setToast("No preview_key on this item");
      return;
    }

    try {
      const { res, data } = await fetchJson(SUGGEST_PREVIEW_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_key: previewKey }),
      });

      if (!res.ok || data?.ok === false) {
        throw new Error(buildErrorMessage(res, data, "Preview presign failed"));
      }

      const previewUrl =
        data?.presignedUrl || data?.presigned_url || data?.url || data?.presignedURL || "";

      if (!previewUrl) throw new Error("Preview URL missing");
      window.open(withFragmentBuster(previewUrl), "_blank", "noopener,noreferrer");
    } catch (e) {
      setCatalogError(e?.message || "Could not open preview");
    }
  }

  const leftStatus = prettyStatus(leftItem?.status);
  const rightStatus = prettyStatus(rightItem?.status);

  return (
    <div
      className={clsx("page", isPrebook && "themePrebook")}
      data-theme={isPrebook ? "prebook" : "instant"}
      style={{
        minHeight: "100vh",
        height: "auto",
        overflowX: "clip",
        backgroundColor: isPrebook ? "rgb(10, 8, 18)" : "rgb(8, 12, 20)",
        backgroundImage: isPrebook
          ? "radial-gradient(1200px 700px at 18% -10%, rgba(168,85,247,0.26), transparent 55%), radial-gradient(900px 500px at 88% 0%, rgba(236,72,153,0.20), transparent 55%), radial-gradient(1000px 650px at 50% 110%, rgba(59,130,246,0.12), transparent 60%)"
          : "radial-gradient(1200px 700px at 18% -10%, rgba(37,99,235,0.22), transparent 55%), radial-gradient(900px 500px at 88% 0%, rgba(14,165,233,0.16), transparent 55%), radial-gradient(1000px 650px at 50% 110%, rgba(99,102,241,0.10), transparent 60%)",
      }}
    >
      <div className="aurora" aria-hidden="true" />
      <div className="noise" aria-hidden="true" />

      {toast ? <div className="toast">{toast}</div> : null}

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
              Charts + PDF are generated in the worker. Typical: 30–90s. Worst: ~2 minutes.
            </div>
          </div>
        </div>
      ) : null}

      {tplModalOpen ? (
        <div className="modalOverlay" onMouseDown={() => setTplModalOpen(false)}>
          <div
            className="modalCard"
            style={{
              maxWidth: 1080,
              width: "min(1080px, 96vw)",
              maxHeight: "88vh",
              overflow: "hidden",
              padding: 0,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "16px 18px",
                borderBottom: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(0,0,0,0.18)",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div className="modalTitle" style={{ margin: 0 }}>
                  {tplMode === "new"
                    ? "New Template"
                    : tplMode === "saveas"
                    ? "Save Template As"
                    : "Edit Template"}
                </div>
                <div className="modalSub" style={{ marginTop: 4 }}>
                  Define headings, sub-headings, chart types, table columns, row limits, and layout order.
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button className="btnSecondary" type="button" onClick={() => setTplModalOpen(false)}>
                  Close
                </button>
                <button className="btnSecondary" type="button" onClick={() => setTplShowPreview((v) => !v)}>
                  {tplShowPreview ? "Hide preview" : "Show preview"}
                </button>
                <button
                  className="btnSecondary"
                  type="button"
                  onClick={exportPrebookTemplates}
                >
                  Export templates
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={saveTemplateDraft}
                  style={{
                    background: theme.accentSoft,
                    border: `1px solid ${theme.accentBorder}`,
                    color: "rgba(255,255,255,0.92)",
                  }}
                >
                  Save template
                </button>
              </div>
            </div>

            <div style={{ overflow: "auto", maxHeight: "calc(88vh - 82px)", padding: 18 }}>
              {!tplDraft ? (
                <div className="mutedSmall">No template loaded.</div>
              ) : (
                <>
                  <div
                    className="card glass"
                    style={{
                      border: `1px solid ${theme.accentBorder}`,
                      background: theme.panelBg,
                      padding: 14,
                      marginBottom: 14,
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                        gap: 12,
                      }}
                    >
                      <div>
                        <label className="label">Template name</label>
                        <input
                          className="input"
                          value={tplDraft.name || ""}
                          onChange={(e) => setTplDraft((p) => ({ ...p, name: e.target.value }))}
                          placeholder='e.g., "Accounting template"'
                          style={{ borderColor: theme.accentBorder }}
                        />
                      </div>
                      <div>
                        <label className="label">Target audience</label>
                        <input
                          className="input"
                          value={tplDraft.targetAudience || ""}
                          onChange={(e) =>
                            setTplDraft((p) => ({ ...p, targetAudience: e.target.value }))
                          }
                          placeholder='e.g., "Sales team"'
                          style={{ borderColor: theme.accentBorder }}
                        />
                      </div>
                    </div>

                    <div style={{ marginTop: 12 }}>
                      <label className="label">Description (optional)</label>
                      <textarea
                        className="textarea"
                        rows={2}
                        value={tplDraft.description || ""}
                        onChange={(e) =>
                          setTplDraft((p) => ({ ...p, description: e.target.value }))
                        }
                        style={{ borderColor: "rgba(255,255,255,0.16)" }}
                        placeholder="What this template is optimized for…"
                      />
                    </div>
                  </div>

                  {tplShowPreview ? (
                    <div
                      className="card glass"
                      style={{
                        border: "1px solid rgba(255,255,255,0.12)",
                        background: "rgba(0,0,0,0.10)",
                        padding: 14,
                        marginBottom: 14,
                      }}
                    >
                      <div className="cardTitleRow" style={{ marginBottom: 12 }}>
                        <div className="cardTitle">Template preview</div>
                        <div className="mutedSmall">Outline + mini wireframe</div>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1.15fr 0.85fr",
                          gap: 14,
                        }}
                      >
                        <div style={{ display: "grid", gap: 8 }}>
                          {outlinePreviewData(tplDraft).map((page) => (
                            <div
                              key={page.key}
                              style={{
                                border: "1px dashed rgba(255,255,255,0.12)",
                                borderRadius: 12,
                                padding: 10,
                              }}
                            >
                              <div style={{ fontWeight: 700 }}>{page.label}</div>
                              <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                                {page.sections.length ? (
                                  page.sections.map((sec) => (
                                    <div key={sec.key} style={{ paddingLeft: 10 }}>
                                      <div style={{ fontWeight: 650 }}>{sec.label}</div>
                                      <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
                                        {sec.subsections.length ? (
                                          sec.subsections.map((sub) => (
                                            <div key={sub.key} style={{ paddingLeft: 12, opacity: 0.95 }}>
                                              {sub.label}{" "}
                                              <span className="mutedSmall" style={{ opacity: 0.75 }}>
                                                — {sub.meta}
                                              </span>
                                            </div>
                                          ))
                                        ) : (
                                          <div className="mutedSmall" style={{ paddingLeft: 12, opacity: 0.75 }}>
                                            No subheadings yet
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ))
                                ) : (
                                  <div className="mutedSmall" style={{ paddingLeft: 10, opacity: 0.75 }}>
                                    No sections yet
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>

                        <div style={{ display: "grid", gap: 12 }}>
                          {tplDraftWireframe.map((page, idx) => (
                            <div
                              key={`${page.title}-${idx}`}
                              style={{
                                border: "1px solid rgba(255,255,255,0.10)",
                                borderRadius: 14,
                                background: "rgba(255,255,255,0.03)",
                                padding: 12,
                              }}
                            >
                              <div className="mutedSmall" style={{ marginBottom: 8 }}>
                                Page wireframe
                              </div>
                              <div style={{ fontWeight: 700, marginBottom: 10 }}>{page.title}</div>
                              <div
                                style={{
                                  borderRadius: 12,
                                  border: "1px dashed rgba(255,255,255,0.12)",
                                  padding: 10,
                                  minHeight: 120,
                                  display: "grid",
                                  gap: 8,
                                }}
                              >
                                {page.rows.length ? (
                                  page.rows.map((row, rowIndex) => (
                                    <div
                                      key={`${row.label}-${rowIndex}`}
                                      style={{
                                        borderRadius: 10,
                                        padding: row.type === "section" ? "10px 12px" : "8px 10px",
                                        background:
                                          row.type === "section"
                                            ? "rgba(168,85,247,0.16)"
                                            : "rgba(255,255,255,0.05)",
                                        border:
                                          row.type === "section"
                                            ? "1px solid rgba(168,85,247,0.35)"
                                            : "1px solid rgba(255,255,255,0.08)",
                                      }}
                                    >
                                      <div style={{ fontWeight: row.type === "section" ? 700 : 500 }}>
                                        {row.label}
                                      </div>
                                      {row.type === "sub" ? (
                                        <div className="mutedSmall" style={{ marginTop: 4 }}>
                                          {row.chart} chart • {row.cols} column(s)
                                        </div>
                                      ) : null}
                                    </div>
                                  ))
                                ) : (
                                  <div className="mutedSmall">No content on this page yet.</div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <div className="mono" style={{ opacity: 0.88 }}>
                      Pages: {tplDraft.layout?.length || 0}
                    </div>
                    <button
                      className="btnSecondary"
                      type="button"
                      onClick={() =>
                        setTplDraft((p) => ({
                          ...p,
                          layout: [
                            ...(p.layout || []),
                            {
                              pageTitle: "New Page",
                              sections: [{ heading: "New Section", subsections: [] }],
                            },
                          ],
                        }))
                      }
                    >
                      + Add page
                    </button>
                  </div>

                  <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                    {(tplDraft.layout || []).map((page, pi) => (
                      <div
                        key={pi}
                        className="card glass"
                        style={{
                          border: `1px solid rgba(255,255,255,0.14)`,
                          background: "rgba(255,255,255,0.04)",
                          padding: 14,
                        }}
                      >
                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <div style={{ flex: 1, minWidth: 260 }}>
                            <label className="label">Page title</label>
                            <input
                              className="input"
                              value={page.pageTitle || ""}
                              onChange={(e) =>
                                setTplDraft((p) => {
                                  const next = deepClone(p);
                                  next.layout[pi].pageTitle = e.target.value;
                                  return next;
                                })
                              }
                              style={{ borderColor: theme.accentBorder }}
                            />
                          </div>
                          <button
                            className="linkBtn"
                            type="button"
                            onClick={() =>
                              setTplDraft((p) => {
                                const next = deepClone(p);
                                next.layout.splice(pi, 1);
                                return next;
                              })
                            }
                          >
                            Remove page
                          </button>
                          <button
                            className="linkBtn"
                            type="button"
                            disabled={pi === 0}
                            onClick={() =>
                              setTplDraft((p) => {
                                const next = deepClone(p);
                                next.layout = moveArrayItem(next.layout || [], pi, pi - 1);
                                return next;
                              })
                            }
                            title="Move page up"
                          >
                            ↑
                          </button>
                          <button
                            className="linkBtn"
                            type="button"
                            disabled={pi === (tplDraft.layout?.length || 0) - 1}
                            onClick={() =>
                              setTplDraft((p) => {
                                const next = deepClone(p);
                                next.layout = moveArrayItem(next.layout || [], pi, pi + 1);
                                return next;
                              })
                            }
                            title="Move page down"
                          >
                            ↓
                          </button>
                          <button
                            className="btnSecondary"
                            type="button"
                            onClick={() =>
                              setTplDraft((p) => {
                                const next = deepClone(p);
                                next.layout[pi].sections = [
                                  ...(next.layout[pi].sections || []),
                                  { heading: "New Section", subsections: [] },
                                ];
                                return next;
                              })
                            }
                          >
                            + Add section
                          </button>
                        </div>

                        <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                          {(page.sections || []).map((sec, si) => (
                            <div
                              key={si}
                              style={{
                                border: "1px solid rgba(255,255,255,0.12)",
                                borderRadius: 14,
                                padding: 12,
                                background: "rgba(0,0,0,0.12)",
                              }}
                            >
                              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                                <div style={{ flex: 1, minWidth: 260 }}>
                                  <label className="label">Section heading</label>
                                  <input
                                    className="input"
                                    value={sec.heading || ""}
                                    onChange={(e) =>
                                      setTplDraft((p) => {
                                        const next = deepClone(p);
                                        next.layout[pi].sections[si].heading = e.target.value;
                                        return next;
                                      })
                                    }
                                    style={{ borderColor: "rgba(255,255,255,0.18)" }}
                                  />
                                </div>
                                <button
                                  className="linkBtn"
                                  type="button"
                                  onClick={() =>
                                    setTplDraft((p) => {
                                      const next = deepClone(p);
                                      next.layout[pi].sections.splice(si, 1);
                                      return next;
                                    })
                                  }
                                >
                                  Remove section
                                </button>
                                <button
                                  className="linkBtn"
                                  type="button"
                                  disabled={si === 0}
                                  onClick={() =>
                                    setTplDraft((p) => {
                                      const next = deepClone(p);
                                      next.layout[pi].sections = moveArrayItem(next.layout[pi].sections || [], si, si - 1);
                                      return next;
                                    })
                                  }
                                  title="Move section up"
                                >
                                  ↑
                                </button>
                                <button
                                  className="linkBtn"
                                  type="button"
                                  disabled={si === (page.sections?.length || 0) - 1}
                                  onClick={() =>
                                    setTplDraft((p) => {
                                      const next = deepClone(p);
                                      next.layout[pi].sections = moveArrayItem(next.layout[pi].sections || [], si, si + 1);
                                      return next;
                                    })
                                  }
                                  title="Move section down"
                                >
                                  ↓
                                </button>
                                <button
                                  className="btnSecondary"
                                  type="button"
                                  onClick={() =>
                                    setTplDraft((p) => {
                                      const next = deepClone(p);
                                      const subsections = next.layout[pi].sections[si].subsections || [];
                                      subsections.push({
                                        title: "New Subheading",
                                        chart: { type: "none", notes: "" },
                                        table: { columns: [], rowLimit: 12 },
                                        bodyNotes: "",
                                      });
                                      next.layout[pi].sections[si].subsections = subsections;
                                      return next;
                                    })
                                  }
                                >
                                  + Add subheading
                                </button>
                              </div>

                              <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                                {(sec.subsections || []).map((sub, xi) => (
                                  <div
                                    key={xi}
                                    style={{
                                      border: "1px solid rgba(255,255,255,0.10)",
                                      borderRadius: 14,
                                      padding: 12,
                                      background: "rgba(255,255,255,0.03)",
                                    }}
                                  >
                                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                                      <div style={{ flex: 1, minWidth: 240 }}>
                                        <label className="label">Subheading title</label>
                                        <input
                                          className="input"
                                          value={sub.title || ""}
                                          onChange={(e) =>
                                            setTplDraft((p) => {
                                              const next = deepClone(p);
                                              next.layout[pi].sections[si].subsections[xi].title = e.target.value;
                                              return next;
                                            })
                                          }
                                          style={{ borderColor: "rgba(255,255,255,0.18)" }}
                                        />
                                      </div>

                                      <div style={{ minWidth: 220 }}>
                                        <label className="label">Chart type</label>
                                        <select
                                          className="input"
                                          value={sub?.chart?.type || "none"}
                                          onChange={(e) =>
                                            setTplDraft((p) => {
                                              const next = deepClone(p);
                                              const cur = next.layout[pi].sections[si].subsections[xi];
                                              cur.chart = cur.chart || { type: "none", notes: "" };
                                              cur.chart.type = e.target.value;
                                              return next;
                                            })
                                          }
                                          style={{
                                            paddingTop: 10,
                                            paddingBottom: 10,
                                            borderColor: "rgba(255,255,255,0.18)",
                                            background: "rgba(0,0,0,0.18)",
                                          }}
                                        >
                                          {CHART_TYPES.map((ct) => (
                                            <option key={ct} value={ct}>
                                              {ct}
                                            </option>
                                          ))}
                                        </select>
                                      </div>

                                      <button
                                        className="linkBtn"
                                        type="button"
                                        disabled={xi === 0}
                                        onClick={() =>
                                          setTplDraft((p) => {
                                            const next = deepClone(p);
                                            next.layout[pi].sections[si].subsections = moveArrayItem(
                                              next.layout[pi].sections[si].subsections || [],
                                              xi,
                                              xi - 1
                                            );
                                            return next;
                                          })
                                        }
                                        title="Move subheading up"
                                      >
                                        ↑
                                      </button>
                                      <button
                                        className="linkBtn"
                                        type="button"
                                        disabled={xi === (sec.subsections?.length || 0) - 1}
                                        onClick={() =>
                                          setTplDraft((p) => {
                                            const next = deepClone(p);
                                            next.layout[pi].sections[si].subsections = moveArrayItem(
                                              next.layout[pi].sections[si].subsections || [],
                                              xi,
                                              xi + 1
                                            );
                                            return next;
                                          })
                                        }
                                        title="Move subheading down"
                                      >
                                        ↓
                                      </button>
                                      <button
                                        className="linkBtn"
                                        type="button"
                                        onClick={() =>
                                          setTplDraft((p) => {
                                            const next = deepClone(p);
                                            next.layout[pi].sections[si].subsections.splice(xi, 1);
                                            return next;
                                          })
                                        }
                                      >
                                        Remove
                                      </button>
                                    </div>

                                    <div
                                      style={{
                                        display: "grid",
                                        gridTemplateColumns: "1.2fr 1fr",
                                        gap: 12,
                                        marginTop: 10,
                                      }}
                                    >
                                      <div>
                                        <label className="label">Chart notes (optional)</label>
                                        <textarea
                                          className="textarea"
                                          rows={2}
                                          value={sub?.chart?.notes || ""}
                                          onChange={(e) =>
                                            setTplDraft((p) => {
                                              const next = deepClone(p);
                                              const cur = next.layout[pi].sections[si].subsections[xi];
                                              cur.chart = cur.chart || { type: "none", notes: "" };
                                              cur.chart.notes = e.target.value;
                                              return next;
                                            })
                                          }
                                          style={{ borderColor: "rgba(255,255,255,0.14)" }}
                                          placeholder="e.g., show YoY and MoM highlights"
                                        />
                                      </div>

                                      <div>
                                        <label className="label">Table columns (comma separated)</label>
                                        <textarea
                                          className="textarea"
                                          rows={2}
                                          value={(sub?.table?.columns || []).join(", ")}
                                          onChange={(e) =>
                                            setTplDraft((p) => {
                                              const next = deepClone(p);
                                              const cur = next.layout[pi].sections[si].subsections[xi];
                                              cur.table = cur.table || { columns: [], rowLimit: 12 };
                                              cur.table.columns = e.target.value
                                                .split(",")
                                                .map((s) => s.trim())
                                                .filter(Boolean);
                                              return next;
                                            })
                                          }
                                          style={{ borderColor: "rgba(255,255,255,0.14)" }}
                                          placeholder="e.g., Month, Revenue, YoY%, MoM%"
                                        />

                                        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
                                          <div className="mutedSmall" style={{ opacity: 0.85 }}>
                                            Row limit
                                          </div>
                                          <input
                                            className="input"
                                            type="number"
                                            min={1}
                                            max={200}
                                            value={Number(sub?.table?.rowLimit || 12)}
                                            onChange={(e) =>
                                              setTplDraft((p) => {
                                                const next = deepClone(p);
                                                const cur = next.layout[pi].sections[si].subsections[xi];
                                                cur.table = cur.table || { columns: [], rowLimit: 12 };
                                                const n = Number(e.target.value);
                                                cur.table.rowLimit = Number.isFinite(n) && n > 0 ? n : 12;
                                                return next;
                                              })
                                            }
                                            style={{
                                              width: 120,
                                              borderColor: "rgba(255,255,255,0.18)",
                                              background: "rgba(0,0,0,0.18)",
                                            }}
                                          />
                                        </div>
                                      </div>
                                    </div>

                                    <div style={{ marginTop: 10 }}>
                                      <label className="label">Body notes (optional)</label>
                                      <textarea
                                        className="textarea"
                                        rows={2}
                                        value={sub.bodyNotes || ""}
                                        onChange={(e) =>
                                          setTplDraft((p) => {
                                            const next = deepClone(p);
                                            next.layout[pi].sections[si].subsections[xi].bodyNotes = e.target.value;
                                            return next;
                                          })
                                        }
                                        style={{ borderColor: "rgba(255,255,255,0.14)" }}
                                        placeholder="What should this subheading cover?"
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div
        className={clsx("shell", isPrebook && "themePrebook")}
        style={{ width: "100%", maxWidth: "none", overflow: "visible" }}
      >
        <header
          className="topbar"
          ref={headerRef}
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
          }}
        >
          <div className="topbarLeft">
            <div className="brandRow">
              <div className="brand">RBR Report Lab</div>
              <span className="pill">Internal</span>
            </div>
            <div className="sub">
              Generate multiple reports, tighten report briefs, and compare quality side-by-side.
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                className="chipPill"
                onClick={() => setActiveTab("instant")}
                style={{
                  border:
                    activeTab === "instant"
                      ? "1px solid rgba(37,99,235,0.55)"
                      : "1px solid rgba(255,255,255,0.14)",
                  background:
                    activeTab === "instant" ? "rgba(37,99,235,0.18)" : "rgba(255,255,255,0.08)",
                  color:
                    activeTab === "instant"
                      ? "rgba(219,234,254,0.98)"
                      : "rgba(255,255,255,0.88)",
                }}
              >
                Instant Report Work Desk
              </button>
              <button
                type="button"
                className="chipPill"
                onClick={() => setActiveTab("prebook")}
                style={{
                  border:
                    activeTab === "prebook"
                      ? `1px solid ${theme.accentBorder}`
                      : "1px solid rgba(255,255,255,0.14)",
                  background: activeTab === "prebook" ? theme.accentSoft : "rgba(255,255,255,0.08)",
                  color:
                    activeTab === "prebook"
                      ? "rgba(245,208,254,0.98)"
                      : "rgba(255,255,255,0.88)",
                }}
              >
                Pre-book Report Work Desk
              </button>
              <button
                type="button"
                className="chipPill"
                onClick={() => setActiveTab("catalog")}
                style={{
                  border:
                    activeTab === "catalog"
                      ? "1px solid rgba(34,197,94,0.40)"
                      : "1px solid rgba(255,255,255,0.14)",
                  background:
                    activeTab === "catalog" ? "rgba(34,197,94,0.16)" : "rgba(255,255,255,0.08)",
                  color:
                    activeTab === "catalog"
                      ? "rgba(220,252,231,0.98)"
                      : "rgba(255,255,255,0.88)",
                }}
              >
                Catalog & Suggestions
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
            <button className="btnSecondary" onClick={() => setShowDebug((v) => !v)} type="button">
              {showDebug ? "Hide Debug" : "Show Debug"}
            </button>
            <button className="btnSecondary" onClick={() => setLeftHidden((v) => !v)} type="button">
              {leftHidden ? "Show Inputs" : "Hide Inputs"}
            </button>
          </div>
        </header>

        {isPrebook && !leftHidden ? (
          <>
            <section
              className="card glass"
              style={{
                position: "relative",
                zIndex: 90,
                marginTop: 14,
                marginInline: 16,
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
                    className="linkBtn"
                    onClick={() => setPrebookBrief(DEFAULT_PREBOOK_BRIEF)}
                    type="button"
                  >
                    Reset brief
                  </button>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(280px, 1fr) minmax(420px, 1.3fr) auto",
                  gap: 12,
                  marginTop: 14,
                  alignItems: "end",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 220 }}>
                  <div className="mutedSmall">Template</div>
                  <select
                    className="input"
                    value={activePrebookTemplateId || ""}
                    onChange={(e) => selectTemplate(e.target.value)}
                    style={{
                      paddingTop: 10,
                      paddingBottom: 10,
                      borderColor: theme.accentBorder,
                      background: "rgba(255,255,255,0.06)",
                    }}
                    title="Choose a Pre-book report template"
                  >
                    <option value="">Standard (default)</option>
                    {prebookTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name || "(unnamed template)"}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button className="linkBtn" type="button" onClick={openNewTemplate}>New</button>
                  <button className="linkBtn" type="button" onClick={openEditTemplate}>Edit</button>
                  <button className="linkBtn" type="button" onClick={openSaveAsTemplate}>Save as</button>
                  <button
                    className="linkBtn"
                    type="button"
                    onClick={deleteActiveTemplate}
                    disabled={!activePrebookTemplateId}
                    title={!activePrebookTemplateId ? "Select a saved template to delete" : "Delete selected template"}
                  >
                    Delete
                  </button>
                  <button className="linkBtn" type="button" onClick={exportPrebookTemplates}>Export</button>
                  <button className="linkBtn" type="button" onClick={triggerImportTemplates}>Import</button>
                  <input
                    ref={tplImportInputRef}
                    type="file"
                    accept="application/json"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files && e.target.files[0];
                      if (f) importPrebookTemplatesFromFile(f);
                    }}
                  />
                </div>

                <button
                  className="btn"
                  type="button"
                  disabled={prebookLoading || quota.remaining <= 0}
                  onClick={generatePrebook}
                  style={{
                    background: theme.accentSoft,
                    border: `1px solid ${theme.accentBorder}`,
                    color: "rgba(255,255,255,0.92)",
                    minWidth: 180,
                  }}
                  title={quota.remaining <= 0 ? "Daily limit reached" : "Generate a Pre-book report"}
                >
                  {prebookLoading ? "Generating…" : "Generate (Pre-book)"}
                </button>
              </div>

              {quotaError ? (
                <div className="mutedSmall" style={{ marginTop: 10 }}>{quotaError}</div>
              ) : null}
            </section>

            <section
              style={{
                display: "grid",
                gridTemplateColumns: "1.35fr 0.9fr",
                gap: 14,
                marginInline: 16,
                marginBottom: 14,
              }}
            >
              <div className="card glass" style={{ border: `1px solid ${theme.accentBorder}`, background: theme.panelBg }}>
                <div className="cardTitleRow">
                  <div className="cardTitle">Report Design Area</div>
                  <div className="mutedSmall">Topic, questions, scope, and quality controls</div>
                </div>

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
                      style={{ borderColor: theme.accentBorder }}
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
                      <label className="label" style={{ margin: 0 }}>Questions</label>
                      <span className="mutedSmall">These go directly into the report prompt</span>
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

                <div
                  className="card glass"
                  style={{
                    marginTop: 14,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(255,255,255,0.04)",
                    padding: 14,
                  }}
                >
                  <div className="cardTitleRow">
                    <div className="cardTitle">Report Brief</div>
                    <div className="mutedSmall">Fine-tune report quality before generation</div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: 12,
                      marginTop: 12,
                    }}
                  >
                    <div>
                      <label className="label">Objective</label>
                      <input
                        className="input"
                        value={prebookBrief.objective}
                        onChange={(e) => updatePrebookBrief("objective", e.target.value)}
                        placeholder="e.g., evaluate market entry opportunity"
                      />
                    </div>

                    <div>
                      <label className="label">Audience</label>
                      <input
                        className="input"
                        value={prebookBrief.audience}
                        onChange={(e) => updatePrebookBrief("audience", e.target.value)}
                        placeholder="e.g., founder / investor / sales team"
                      />
                    </div>

                    <div>
                      <label className="label">Geography</label>
                      <select
                        className="input"
                        value={prebookBrief.geography}
                        onChange={(e) => updatePrebookBrief("geography", e.target.value)}
                      >
                        <option value="India">India</option>
                        <option value="Global">Global</option>
                        <option value="State-specific">State-specific</option>
                        <option value="City-specific">City-specific</option>
                      </select>
                    </div>

                    <div>
                      <label className="label">Time Horizon</label>
                      <select
                        className="input"
                        value={prebookBrief.horizon}
                        onChange={(e) => updatePrebookBrief("horizon", e.target.value)}
                      >
                        <option value="Current snapshot">Current snapshot</option>
                        <option value="1-3 years">1-3 years</option>
                        <option value="3-5 years">3-5 years</option>
                        <option value="5-10 years">5-10 years</option>
                      </select>
                    </div>

                    <div>
                      <label className="label">Depth</label>
                      <select
                        className="input"
                        value={prebookBrief.depth}
                        onChange={(e) => updatePrebookBrief("depth", e.target.value)}
                      >
                        <option value="basic">Basic</option>
                        <option value="standard">Standard</option>
                        <option value="detailed">Detailed</option>
                        <option value="expert">Expert</option>
                      </select>
                    </div>

                    <div>
                      <label className="label">Tone</label>
                      <select
                        className="input"
                        value={prebookBrief.tone}
                        onChange={(e) => updatePrebookBrief("tone", e.target.value)}
                      >
                        <option value="strategic">Strategic</option>
                        <option value="investor">Investor</option>
                        <option value="consulting">Consulting</option>
                        <option value="operational">Operational</option>
                      </select>
                    </div>

                    <div>
                      <label className="label">Charts</label>
                      <select
                        className="input"
                        value={prebookBrief.includeCharts}
                        onChange={(e) => updatePrebookBrief("includeCharts", e.target.value)}
                      >
                        <option value="light">Light</option>
                        <option value="balanced">Balanced</option>
                        <option value="heavy">Heavy</option>
                      </select>
                    </div>

                    <div>
                      <label className="label">Tables</label>
                      <select
                        className="input"
                        value={prebookBrief.includeTables}
                        onChange={(e) => updatePrebookBrief("includeTables", e.target.value)}
                      >
                        <option value="light">Light</option>
                        <option value="balanced">Balanced</option>
                        <option value="heavy">Heavy</option>
                      </select>
                    </div>

                    <div>
                      <label className="label">Competitor Coverage</label>
                      <select
                        className="input"
                        value={prebookBrief.competitorCoverage}
                        onChange={(e) => updatePrebookBrief("competitorCoverage", e.target.value)}
                      >
                        <option value="top_5">Top 5</option>
                        <option value="top_10">Top 10</option>
                        <option value="emerging_only">Emerging only</option>
                        <option value="mixed">Mixed</option>
                      </select>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: 12,
                      marginTop: 12,
                    }}
                  >
                    <label className="chipPill" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={prebookBrief.includeAssumptions}
                        onChange={(e) => updatePrebookBrief("includeAssumptions", e.target.checked)}
                      />
                      Include assumptions explicitly
                    </label>
                    <label className="chipPill" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={prebookBrief.mentionDataGaps}
                        onChange={(e) => updatePrebookBrief("mentionDataGaps", e.target.checked)}
                      />
                      Mention data gaps clearly
                    </label>
                    <label className="chipPill" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={prebookBrief.sectionRecommendations}
                        onChange={(e) => updatePrebookBrief("sectionRecommendations", e.target.checked)}
                      />
                      Add section recommendations
                    </label>
                    <label className="chipPill" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={prebookBrief.includeScorecard}
                        onChange={(e) => updatePrebookBrief("includeScorecard", e.target.checked)}
                      />
                      Include executive scorecard
                    </label>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <label className="label">Must Include</label>
                    <textarea
                      className="textarea"
                      rows={2}
                      value={prebookBrief.mustInclude}
                      onChange={(e) => updatePrebookBrief("mustInclude", e.target.value)}
                      placeholder="e.g., TAM/SAM/SOM, competitor pricing, policy impact"
                    />
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <label className="label">Avoid / Special Notes</label>
                    <textarea
                      className="textarea"
                      rows={2}
                      value={prebookBrief.avoidNotes}
                      onChange={(e) => updatePrebookBrief("avoidNotes", e.target.value)}
                      placeholder="e.g., avoid weak global estimates; prioritize India-specific data"
                    />
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gap: 14 }}>
                <div className="card glass" style={{ border: `1px solid ${theme.accentBorder}`, background: theme.panelBg }}>
                  <div className="cardTitleRow">
                    <div className="cardTitle">Prompt Strength</div>
                    <div className="mono">{prebookPromptStrength}/100</div>
                  </div>

                  <div className="progressBar" style={{ marginTop: 10 }}>
                    <div className="progressFill" style={{ width: `${prebookPromptStrength}%` }} />
                  </div>

                  <div style={{ marginTop: 8, fontWeight: 700 }}>{promptStrengthLabel}</div>
                  <div className="mutedSmall" style={{ marginTop: 6 }}>
                    Stronger briefs usually produce finer, more decision-ready reports.
                  </div>

                  <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
                    {promptStrengthTips.map((tip, idx) => (
                      <div key={`${tip}-${idx}`} className="mutedSmall">• {tip}</div>
                    ))}
                  </div>
                </div>

                <div className="card glass" style={{ border: `1px solid ${theme.accentBorder}`, background: theme.panelBg }}>
                  <div className="cardTitleRow">
                    <div className="cardTitle">Template Summary</div>
                    <div className="mutedSmall">Visible structure before generation</div>
                  </div>

                  <div style={{ marginTop: 10, fontWeight: 700 }}>
                    {activePrebookTemplate ? activePrebookTemplate.name : "Standard Default"}
                  </div>
                  <div className="mutedSmall" style={{ marginTop: 6 }}>
                    Audience:{" "}
                    {activePrebookTemplate
                      ? activePrebookTemplate.targetAudience || "—"
                      : prebookBrief.audience || "—"}
                  </div>
                  <div className="mutedSmall">
                    Version: {selectedOrDefaultPrebookTemplate?.version || 1}
                  </div>
                  <div className="mutedSmall">Pages: {activeTemplateStats.pages}</div>
                  <div className="mutedSmall">Sections: {activeTemplateStats.sections}</div>
                  <div className="mutedSmall">Subheadings: {activeTemplateStats.subsections}</div>

                  {!activePrebookTemplate ? (
                    <div className="mutedSmall" style={{ marginTop: 8, opacity: 0.85 }}>
                      Using Standard default template.
                    </div>
                  ) : null}

                  <div style={{ marginTop: 12, display: "grid", gap: 8, maxHeight: 280, overflow: "auto" }}>
                    {activeTemplateOutline.map((page) => (
                      <div
                        key={page.key}
                        style={{
                          border: "1px solid rgba(255,255,255,0.10)",
                          borderRadius: 12,
                          padding: 10,
                          background: "rgba(255,255,255,0.03)",
                        }}
                      >
                        <div style={{ fontWeight: 650 }}>{page.label}</div>
                        <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
                          {page.sections.map((sec) => (
                            <div key={sec.key} style={{ paddingLeft: 10 }}>
                              <div>{sec.label}</div>
                              {sec.subsections.map((sub) => (
                                <div key={sub.key} className="mutedSmall" style={{ paddingLeft: 10, marginTop: 4 }}>
                                  {sub.label}
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </>
        ) : null}

        <div className={clsx("body", (leftHidden || isPrebook || isCatalog) && "bodyFull")}>
          {!leftHidden && !isPrebook && !isCatalog ? (
            <aside className="left">
              <div className="panelScroll">
                <div className="card glass">
                  <div className="cardTitleRow">
                    <div className="cardTitle">Generate (Instant)</div>
                    <button className="linkBtn" onClick={() => setQuestions(DEFAULT_QUESTIONS)} type="button">
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

                <div className="card" style={{ marginTop: 12 }}>
                  <div className="cardTitleRow">
                    <div className="cardTitle">Generated Reports (Instant)</div>
                    <div className="mutedSmall">{activeHistory.length} items</div>
                  </div>

                  <div className="historyTools">
                    <input
                      className="input inputSm"
                      value={historyQuery}
                      onChange={(e) => setHistoryQuery(e.target.value)}
                      placeholder="Search title / topic / instantId…"
                    />
                    <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
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
                      <div className="mutedSmall">Generate a report, or clear the search/filter.</div>
                    </div>
                  ) : (
                    <HistoryTable
                      activeTab={activeTab}
                      filteredHistory={filteredHistory}
                      copyToClipboard={copyToClipboard}
                      removeItem={removeItem}
                      setLeft={setLeft}
                      setRight={setRight}
                    />
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
                    <pre className="debugPre">{JSON.stringify(lastApiResponse, null, 2)}</pre>
                  </div>
                ) : null}
              </div>
            </aside>
          ) : null}

          <main className="right">
            {isCatalog ? (
              <CatalogSuggestionsPanel
                catalogSearch={catalogSearch}
                setCatalogSearch={setCatalogSearch}
                loadCatalog={loadCatalog}
                catalogLoading={catalogLoading}
                catalogError={catalogError}
                catalogItems={catalogItems}
                catalogMeta={catalogMeta}
                suggestTesterQuery={suggestTesterQuery}
                setSuggestTesterQuery={setSuggestTesterQuery}
                runSuggestionTest={runSuggestionTest}
                suggestLoading={suggestLoading}
                suggestError={suggestError}
                suggestResults={suggestResults}
                openCatalogPreview={openCatalogPreview}
                copyToClipboard={copyToClipboard}
              />
            ) : isPrebook ? (
              <div className="card glass" style={{ border: `1px solid ${theme.accentBorder}`, background: theme.panelBg }}>
                <div className="cardTitleRow">
                  <div className="cardTitle">Generated Reports (Pre-book)</div>
                  <div className="mutedSmall">{activeHistory.length} items</div>
                </div>

                <div className="historyTools">
                  <input
                    className="input inputSm"
                    value={historyQuery}
                    onChange={(e) => setHistoryQuery(e.target.value)}
                    placeholder="Search title / topic / reportId…"
                  />
                  <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
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
                    <div className="mutedSmall">Generate a report, or clear the search/filter.</div>
                  </div>
                ) : activeTab === "prebook" ? (
                  <GroupedHistoryTable
                    activeTab={activeTab}
                    groupedHistory={groupedFilteredHistory}
                    expandedDateGroups={expandedDateGroups}
                    toggleDateGroup={toggleDateGroup}
                    copyToClipboard={copyToClipboard}
                    removeItem={removeItem}
                    setLeft={setLeft}
                    setRight={setRight}
                    sendPrebookToProduction={sendPrebookToProduction}
                    publishingIds={publishingIds}
                  />
                ) : (
                  <HistoryTable
                    activeTab={activeTab}
                    filteredHistory={filteredHistory}
                    copyToClipboard={copyToClipboard}
                    removeItem={removeItem}
                    setLeft={setLeft}
                    setRight={setRight}
                  />
                )}

                {error ? <div className="errorBox">Error: {error}</div> : null}
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
                    <pre className="debugPre">{JSON.stringify(lastApiResponse, null, 2)}</pre>
                  </div>
                ) : null}
              </div>
            ) : null}

            {!isCatalog ? (
              <>
                <div className="compareHeader">
                  <div className="compareTitleRow">
                    <div className="compareTitle">Compare PDFs</div>
                    <div className="compareBadges">
                      <span className={clsx("miniStatus", `st-${leftStatus}`)}>Left: {leftItem?.status || "none"}</span>
                      <span className={clsx("miniStatus", `st-${rightStatus}`)}>Right: {rightItem?.status || "none"}</span>
                    </div>
                  </div>
                  <div className="compareHint">
                    Choose “View Left / View Right” from the table. No cropping — panes fit the screen.
                  </div>
                </div>

                <div className="pdfGrid">
                  <PdfPane side="Left" item={leftItem} emptyIcon="⬅️" emptyTitle="Select a Left report" />
                  <PdfPane side="Right" item={rightItem} emptyIcon="➡️" emptyTitle="Select a Right report" />
                </div>
              </>
            ) : null}
          </main>
        </div>

        <footer className="footer">
          {isCatalog
            ? "Tip: Use this tab to compare catalog records against live /suggest output and improve relevance."            : "Tip: Generate 2–3 reports with small prompt changes and compare output quality."}
        </footer>
      </div>
    </div>
  );
}


function CatalogSuggestionsPanel({
  catalogSearch,
  setCatalogSearch,
  loadCatalog,
  catalogLoading,
  catalogError,
  catalogItems,
  catalogMeta,
  suggestTesterQuery,
  setSuggestTesterQuery,
  runSuggestionTest,
  suggestLoading,
  suggestError,
  suggestResults,
  openCatalogPreview,
  copyToClipboard,
}) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div
        className="card glass"
        style={{
          border: "1px solid rgba(34,197,94,0.28)",
          background: "rgba(7,18,12,0.55)",
        }}
      >
        <div className="cardTitleRow">
          <div className="cardTitle">Published Reports Catalog</div>
          <div className="mutedSmall">{catalogMeta?.total || catalogItems.length} items</div>
        </div>

        <div className="historyTools" style={{ marginTop: 12 }}>
          <input
            className="input inputSm"
            value={catalogSearch}
            onChange={(e) => setCatalogSearch(e.target.value)}
            placeholder="Search title / slug / keyword..."
            onKeyDown={(e) => {
              if (e.key === "Enter") loadCatalog();
            }}
          />
          <button className="btnSecondary" type="button" onClick={() => loadCatalog()}>
            {catalogLoading ? "Loading..." : "Refresh Catalog"}
          </button>
        </div>

        {catalogError ? <div className="errorBox">Error: {catalogError}</div> : null}

        {!catalogItems.length && !catalogLoading ? (
          <div className="empty fancyEmpty">
            <div className="emptyIcon">🗂️</div>
            <div className="emptyTitle">No catalog items found</div>
            <div className="mutedSmall">Update VITE_CATALOG_API after you connect your new Lambda.</div>
          </div>
        ) : (
          <div className="tableWrap" style={{ marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th style={{ width: 170 }}>Slug</th>
                  <th>Keywords</th>
                  <th style={{ width: 165 }}>Published</th>
                  <th style={{ width: 280 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {catalogItems.map((item) => (
                  <tr key={item.id} className="row">
                    <td>
                      <div className="titleCell">{item.title || "-"}</div>
                      <div className="mutedSmall mono">{item.reportId || item.full_key || "-"}</div>
                    </td>
                    <td className="mono">{item.slug || "-"}</td>
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {(item.keywords || []).length ? (
                          item.keywords.slice(0, 6).map((kw, idx) => (
                            <span key={`${item.id}-kw-${idx}`} className="chipDisabled">
                              {kw}
                            </span>
                          ))
                        ) : (
                          <span className="mutedSmall">No keywords</span>
                        )}
                      </div>
                    </td>
                    <td className="mono">
                      {item.sentAt ? new Date(item.sentAt).toLocaleString() : "-"}
                    </td>
                    <td>
                      <div className="rowActions">
                        <button className="chip" type="button" onClick={() => runSuggestionTest(item.title || item.slug || "") }>
                          Test This
                        </button>
                        <button className="chip" type="button" onClick={() => openCatalogPreview(item)}>
                          Preview
                        </button>
                        <button className="chip" type="button" onClick={() => copyToClipboard(item.slug || item.title || "") }>
                          Copy
                        </button>
                      </div>
                      {item.preview_key ? (
                        <div className="mutedSmall" style={{ marginTop: 6 }}>
                          preview_key: <span className="mono">{item.preview_key}</span>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div
        className="card glass"
        style={{
          border: "1px solid rgba(34,197,94,0.28)",
          background: "rgba(7,18,12,0.55)",
        }}
      >
        <div className="cardTitleRow">
          <div className="cardTitle">Suggestion Tester</div>
          <div className="mutedSmall">Uses the live /suggest API</div>
        </div>

        <div className="historyTools" style={{ marginTop: 12 }}>
          <input
            className="input inputSm"
            value={suggestTesterQuery}
            onChange={(e) => setSuggestTesterQuery(e.target.value)}
            placeholder="Type the same query a frontend user would type..."
            onKeyDown={(e) => {
              if (e.key === "Enter") runSuggestionTest();
            }}
          />
          <button className="btnSecondary" type="button" onClick={() => runSuggestionTest()}>
            {suggestLoading ? "Checking..." : "Test Suggestions"}
          </button>
        </div>

        {suggestError ? <div className="errorBox">Error: {suggestError}</div> : null}

        {!suggestResults.length && !suggestLoading ? (
          <div className="empty fancyEmpty" style={{ marginTop: 12 }}>
            <div className="emptyIcon">🔎</div>
            <div className="emptyTitle">No suggestion results yet</div>
            <div className="mutedSmall">Run a query to see exactly what the public frontend would receive.</div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            {suggestResults.map((item) => (
              <div
                key={item.id}
                className="card"
                style={{
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.03)",
                }}
              >
                <div className="cardTitleRow">
                  <div>
                    <div className="titleCell">{item.title}</div>
                    <div className="mutedSmall mono">{item.slug || item.preview_key || "-"}</div>
                  </div>
                  <div className="rowActions">
                    <button className="chip" type="button" onClick={() => openCatalogPreview(item)}>
                      Preview
                    </button>
                    <button className="chip" type="button" onClick={() => copyToClipboard(item.preview_key || item.slug || item.title || "") }>
                      Copy
                    </button>
                  </div>
                </div>

                {(item.keywords || []).length ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                    {item.keywords.map((kw, idx) => (
                      <span key={`${item.id}-suggest-kw-${idx}`} className="chipDisabled">
                        {kw}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


function HistoryTable({
  activeTab,
  filteredHistory,
  copyToClipboard,
  removeItem,
  setLeft,
  setRight,
  sendPrebookToProduction,
  publishingIds,
}) {
  return (
    <div className="tableWrap">
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 150 }}>Time</th>
            <th>Topic</th>
            <th style={{ width: 140 }}>{activeTab === "instant" ? "Instant" : "Pre-book"}</th>
            <th style={{ width: 105 }}>Status</th>
            <th style={{ width: 380 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredHistory.map((h) => {
            const dt = h.createdAt ? new Date(h.createdAt) : null;
            const timeStr = dt ? dt.toLocaleString() : "-";
            const st = prettyStatus(h.status);

            const canSend =
              activeTab === "prebook" &&
              ["completed", "done"].includes(st) &&
              h.productionStatus !== "published";

            return (
              <tr key={h.id} className="row">
                <td className="mono">{timeStr}</td>

                <td>
                  <div className="titleCell">{h.title || h.topic}</div>
                  <div className="mutedSmall">{h.topic}</div>
                </td>

                <td className="mono">
                  <div className="monoRow">
                    <span>
                      {activeTab === "instant"
                        ? h.instantId || "-"
                        : h.reportId || "-"}
                    </span>

                    {(activeTab === "instant" ? h.instantId : h.reportId) ? (
                      <button
                        className="miniBtn"
                        onClick={() =>
                          copyToClipboard(
                            activeTab === "instant" ? h.instantId : h.reportId
                          )
                        }
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
                    <button
                      className="chip"
                      onClick={() => setLeft(h.id)}
                      type="button"
                    >
                      View Left
                    </button>

                    <button
                      className="chip"
                      onClick={() => setRight(h.id)}
                      type="button"
                    >
                      View Right
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

                    {activeTab === "prebook" ? (
                      <button
                        className="chip"
                        disabled={!canSend || publishingIds?.[h.id]}
                        onClick={() => sendPrebookToProduction(h)}
                        type="button"
                      >
                        {h.productionStatus === "published"
                          ? "Sent to Production"
                          : publishingIds?.[h.id]
                          ? "Sending..."
                          : "Send to Production"}
                      </button>
                    ) : null}

                    <button
                      className="chipDanger"
                      onClick={() => removeItem(h.id)}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>

                  {activeTab === "prebook" && h.productionSlug ? (
                    <div className="mutedSmall" style={{ marginTop: 6 }}>
                      Production slug: <span className="mono">{h.productionSlug}</span>
                    </div>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


function GroupedHistoryTable({
  activeTab,
  groupedHistory,
  expandedDateGroups,
  toggleDateGroup,
  copyToClipboard,
  removeItem,
  setLeft,
  setRight,
  sendPrebookToProduction,
  publishingIds,
}) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {groupedHistory.map((group, index) => {
        const isOpen =
          expandedDateGroups[group.dateKey] !== undefined
            ? expandedDateGroups[group.dateKey]
            : index === 0;

        return (
          <div
            key={group.dateKey}
            className="card"
            style={{
              border: "1px solid rgba(168,85,247,0.22)",
              background: "rgba(168,85,247,0.04)",
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => toggleDateGroup(group.dateKey)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "14px 16px",
                background: isOpen
                    ? "linear-gradient(180deg, rgba(168,85,247,0.22), rgba(168,85,247,0.12))"
                    : "linear-gradient(180deg, rgba(168,85,247,0.14), rgba(168,85,247,0.08))",
                border: "none",
                borderBottom: isOpen ? "1px solid rgba(168,85,247,0.32)" : "none",
                color: "rgba(255,255,255,0.96)",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontWeight: 700 }}>{group.label}</div>
                <div className="mutedSmall">
                  {group.items.length} report{group.items.length > 1 ? "s" : ""}
                </div>
              </div>

              <div
                style={{
                  fontSize: 18,
                  lineHeight: 1,
                  opacity: 0.9,
                  transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)",
                  transition: "transform 160ms ease",
                }}
              >
                ▾
              </div>
            </button>

            {isOpen ? (
              <div style={{ padding: 12 }}>
                <HistoryTable
                  activeTab={activeTab}
                  filteredHistory={group.items}
                  copyToClipboard={copyToClipboard}
                  removeItem={removeItem}
                  setLeft={setLeft}
                  setRight={setRight}
                  sendPrebookToProduction={sendPrebookToProduction}
                  publishingIds={publishingIds}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function PdfPane({ side, item, emptyIcon, emptyTitle }) {
  return (
    <section className="pdfPane">
      <div className="pdfPaneHeader">
        <div className="paneTitle">{side}</div>
        <div className="paneMeta">
          {item ? (
            <>
              <span className="mono">{item.instantId || item.reportId || item.id}</span>
              <span className="dot">•</span>
              <span className="mutedSmall">{item.reportName || item.title || item.topic}</span>
            </>
          ) : (
            <span className="mutedSmall">No selection</span>
          )}
        </div>
        {item?.pdfUrl ? (
          <a className="openBtn" href={item.pdfUrl} target="_blank" rel="noreferrer">
            Open
          </a>
        ) : null}
      </div>

      <div className="pdfFill">
        {item?.pdfUrl ? (
          <iframe className="pdfFrame" src={item.pdfUrl} title={`${side} PDF`} />
        ) : (
          <div className="pdfEmpty fancyEmpty">
            <div className="emptyIcon">{emptyIcon}</div>
            <div className="emptyTitle">{emptyTitle}</div>
            <div className="mutedSmall">Use “View {side}” in the table.</div>
          </div>
        )}
      </div>
    </section>
  );
}
