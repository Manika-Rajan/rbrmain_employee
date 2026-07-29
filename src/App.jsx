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

function getDateFolderFromIso(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function resolveInstantPdfKey(data = {}) {
  const key =
    data.s3Key ||
    data.s3_key ||
    data.pdfKey ||
    data.pdf_key ||
    data.fileKey ||
    data.file_key ||
    data.key ||
    "";

  if (!key) return "";

  // Employee instant reports are stored in:
  // instant_reports/EMP10000001/RBR_Instant_<topic>_<date>.pdf
  // Do not force the old customer-flow prefix: instant/
  if (key.startsWith("instant_reports/")) return key;

  return key;
}

function resolvePrebookPdfKey(item = {}, statusData = {}) {
  const reportId =
    statusData.reportId ||
    statusData.report_id ||
    statusData.prebookId ||
    statusData.id ||
    item.reportId ||
    item.report_id ||
    item.prebookId ||
    item.id ||
    "";

  const directKey =
    statusData.s3Key ||
    statusData.pdfKey ||
    statusData.s3_key ||
    statusData.pdf_key ||
    statusData.key ||
    item.s3Key ||
    item.pdfKey ||
    item.s3_key ||
    item.pdf_key ||
    item?.raw?.s3Key ||
    item?.raw?.pdfKey ||
    item?.raw?.s3_key ||
    item?.raw?.pdf_key ||
    "";

  if (directKey) return directKey;
  if (!reportId) return "";

  const folder = getDateFolderFromIso(
    statusData.createdAt ||
      statusData.created_at ||
      statusData.completedAt ||
      statusData.updatedAt ||
      item.createdAt ||
      item.created_at ||
      item.updatedAt
  );

  return `prebook/pdf/${folder}/${reportId}.pdf`;
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

function normalizeSlug(value = "") {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
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
                title: `Segment ${i + 1}`,
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

function unwrapDynamoValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (Object.prototype.hasOwnProperty.call(value, "S")) return value.S;
  if (Object.prototype.hasOwnProperty.call(value, "N")) return Number(value.N);
  if (Object.prototype.hasOwnProperty.call(value, "BOOL")) return Boolean(value.BOOL);
  if (Object.prototype.hasOwnProperty.call(value, "NULL")) return null;
  if (Array.isArray(value.L)) return value.L.map(unwrapDynamoValue);
  if (value.M && typeof value.M === "object") {
    return Object.fromEntries(Object.entries(value.M).map(([key, entry]) => [key, unwrapDynamoValue(entry)]));
  }
  return value;
}

function parseJsonRecursively(value, maxDepth = 3) {
  let current = value;
  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (typeof current !== "string") break;
    const trimmed = current.trim();
    if (!trimmed || !["{", "["].includes(trimmed[0])) break;
    try {
      current = JSON.parse(trimmed);
    } catch {
      break;
    }
  }
  return current;
}

function normalizeSaleDateValue(value) {
  const raw = unwrapDynamoValue(value);
  if (raw === undefined || raw === null || raw === "") return "";

  const numeric = typeof raw === "number" ? raw : /^\d{10,13}$/.test(String(raw).trim()) ? Number(raw) : NaN;
  if (Number.isFinite(numeric)) {
    const milliseconds = numeric < 100000000000 ? numeric * 1000 : numeric;
    const d = new Date(milliseconds);
    return Number.isNaN(d.getTime()) ? String(raw) : d.toISOString();
  }

  return String(raw);
}

function getSaleDateValue(item = {}) {
  const payment = unwrapDynamoValue(item?.payment) || {};
  return normalizeSaleDateValue(
    item.saleDate ||
      item.sale_date ||
      item.purchaseDate ||
      item.purchase_date ||
      item.purchasedOn ||
      item.purchased_on ||
      item.paymentDate ||
      item.payment_date ||
      item.transactionDate ||
      item.transaction_date ||
      item.paidAt ||
      item.paid_at ||
      item.capturedAt ||
      item.captured_at ||
      payment.createdAt ||
      payment.created_at ||
      item.createdAt ||
      item.created_at ||
      item.updatedAt ||
      item.updated_at ||
      item.timestamp ||
      item.date ||
      ""
  );
}

function getMonthKeyFromDateKey(dateKey) {
  if (!dateKey || dateKey === "unknown-date") return "unknown-month";
  return String(dateKey).slice(0, 7);
}

function formatMonthGroupLabel(monthKey) {
  if (!monthKey || monthKey === "unknown-month") return "Unknown month";
  const d = new Date(`${monthKey}-01T00:00:00`);
  if (Number.isNaN(d.getTime())) return monthKey;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long" });
}

function toAmountNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function formatInr(value) {
  const n = toAmountNumber(value);
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `₹${n}`;
  }
}

function normalizeSalesPayload(payload) {
  const envelope = parseJsonRecursively(payload);
  const parsed = parseJsonRecursively(envelope?.body ?? envelope);

  const candidateArrays = [
    parsed,
    parsed?.items,
    parsed?.Items,
    parsed?.sales,
    parsed?.payments,
    parsed?.transactions,
    parsed?.purchases,
    parsed?.records,
    parsed?.results,
    parsed?.data,
    parsed?.users,
    parsed?.userProfiles,
    parsed?.user_profiles,
  ];

  const sourceRows = candidateArrays.find(Array.isArray) || [];
  const rawItems = [];

  sourceRows.forEach((sourceRow) => {
    const user = unwrapDynamoValue(sourceRow) || {};
    const reportsValue = unwrapDynamoValue(
      user.reports || user.purchases || user.orders || user.sales || user.transactions
    );

    if (Array.isArray(reportsValue) && reportsValue.length) {
      reportsValue.forEach((report, reportIndex) => {
        const normalizedReport = unwrapDynamoValue(report) || {};
        rawItems.push({
          ...user,
          ...normalizedReport,
          __user: user,
          __nestedIndex: reportIndex,
        });
      });
    } else {
      rawItems.push(user);
    }
  });

  const normalized = rawItems.map((rawItem, index) => {
    const item = unwrapDynamoValue(rawItem) || {};
    const user = unwrapDynamoValue(item.__user) || {};
    const payment = unwrapDynamoValue(item.payment) || {};
    const saleDate = getSaleDateValue({
      ...user,
      ...item,
      purchased_on: item.purchased_on || user.purchased_on,
      purchasedOn: item.purchasedOn || user.purchasedOn,
    });

    const amount = toAmountNumber(
      item?.amount ??
        item?.saleAmount ??
        item?.sale_amount ??
        item?.paidAmount ??
        item?.paid_amount ??
        item?.amountPaid ??
        item?.amount_paid ??
        item?.pricePaid ??
        item?.price_paid ??
        item?.finalAmount ??
        item?.final_amount ??
        item?.price ??
        item?.total ??
        item?.orderAmount ??
        item?.order_amount ??
        item?.paymentAmount ??
        item?.payment_amount ??
        payment?.amount ??
        0
    );

    const paymentId =
      item?.paymentId ||
      item?.payment_id ||
      item?.razorpay_payment_id ||
      payment?.id ||
      payment?.payment_id ||
      "";
    const orderId =
      item?.orderId ||
      item?.order_id ||
      item?.razorpay_order_id ||
      payment?.order_id ||
      "";
    const reportId =
      item?.reportId ||
      item?.report_id ||
      item?.slug ||
      item?.reportSlug ||
      item?.report_slug ||
      "";
    const mobile =
      item?.mobile ||
      item?.phone ||
      item?.userPhone ||
      item?.user_phone ||
      item?.customerPhone ||
      item?.customer_phone ||
      user?.mobile ||
      user?.phone ||
      user?.userId ||
      user?.user_id ||
      "";

    return {
      id:
        item?.id ||
        paymentId ||
        orderId ||
        [mobile, reportId, saleDate, item.__nestedIndex ?? index].filter((x) => x !== "").join("|") ||
        `sale-${index}`,
      saleDate,
      dateKey: getDateKey(saleDate),
      mobile,
      name:
        item?.name ||
        item?.customerName ||
        item?.customer_name ||
        item?.userName ||
        item?.user_name ||
        user?.name ||
        user?.customerName ||
        user?.customer_name ||
        "",
      reportTitle:
        item?.reportTitle ||
        item?.report_title ||
        item?.reportName ||
        item?.report_name ||
        item?.title ||
        item?.topic ||
        item?.name_of_report ||
        "Untitled report",
      reportId,
      reportType:
        item?.reportType ||
        item?.report_type ||
        item?.type ||
        item?.productType ||
        item?.product_type ||
        "",
      amount,
      status:
        item?.status ||
        item?.paymentStatus ||
        item?.payment_status ||
        payment?.status ||
        "paid",
      paymentId,
      orderId,
      raw: item,
    };
  });

  const seen = new Set();
  return normalized.filter((sale) => {
    const key =
      sale.paymentId ||
      [sale.orderId, sale.reportId, sale.mobile, sale.saleDate, sale.amount].map((x) => String(x || "")).join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


function getAdsDateValue(item = {}) {
  return (
    item.date ||
    item.dateKey ||
    item.date_key ||
    item.day ||
    item.pulledAt ||
    item.pulled_at ||
    item.updatedAt ||
    item.updated_at ||
    item.createdAt ||
    item.created_at ||
    ""
  );
}

function formatNumberCompact(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0";
  try {
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(n);
  } catch {
    return String(n);
  }
}

function toStringList(value) {
  if (Array.isArray(value)) return value.map((x) => String(x || "").trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[|,\n]/g)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeAdsQuality(item = {}) {
  const q = pickLoose(
    item.quality,
    item.trafficQuality,
    item.traffic_quality,
    item.intent,
    item.classification,
    ""
  );
  if (q) return q;
  const sales = Number(item.sales || item.sale_count || item.saleCount || 0);
  const leads = Number(item.leads || item.lead_count || item.leadCount || 0);
  const websiteSearches = toStringList(
    item.websiteSearchTerms || item.website_search_terms || item.websiteSearches || item.website_searches
  ).length;
  const term = normalize(item.searchTerm || item.search_term || item.query || "");
  if (sales > 0) return "Converted";
  if (leads > 0) return "Warm";
  if (websiteSearches > 0) return "Interested";
  if (["free", "pdf", "project", "student", "job", "salary"].some((x) => term.includes(x))) return "Low intent";
  return "Needs review";
}

function pickLoose(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function normalizeAdsIntelligencePayload(payload) {
  const parsed = payload && typeof payload.body === "string" ? JSON.parse(payload.body) : payload;
  const rawItems = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.items)
    ? parsed.items
    : Array.isArray(parsed?.rows)
    ? parsed.rows
    : Array.isArray(parsed?.results)
    ? parsed.results
    : Array.isArray(parsed?.data)
    ? parsed.data
    : [];

  return rawItems.map((item, index) => {
    const dateValue = getAdsDateValue(item);
    const websiteTerms = toStringList(
      pickLoose(
        item.websiteSearchTerms,
        item.website_search_terms,
        item.websiteSearches,
        item.website_searches,
        item.siteSearchTerms,
        item.site_search_terms,
        item.contextSearched,
        item.context_searched
      )
    );
    const searchTerm = pickLoose(
      item.searchTerm,
      item.search_term,
      item.googleSearchTerm,
      item.google_search_term,
      item.query,
      item.userQuery
    );
    const keyword = pickLoose(item.keyword, item.adKeyword, item.ad_keyword, item.googleKeyword, item.google_keyword);
    const clicks = Number(pickLoose(item.clicks, item.click_count, item.clickCount, 0)) || 0;
    const cost = toAmountNumber(pickLoose(item.cost, item.spend, item.amountSpent, item.amount_spent, 0));
    const leads = Number(pickLoose(item.leads, item.lead_count, item.leadCount, 0)) || 0;
    const sales = Number(pickLoose(item.sales, item.sale_count, item.saleCount, item.conversions, 0)) || 0;
    const revenue = toAmountNumber(pickLoose(item.revenue, item.salesValue, item.sales_value, item.conversionValue, item.conversion_value, 0));

    return {
      id: pickLoose(item.id, item.trafficId, item.traffic_id, item.rowId, `${dateValue || "ads"}-${index}`),
      date: dateValue,
      dateKey: getDateKey(dateValue),
      campaign: pickLoose(item.campaign, item.campaignName, item.campaign_name, "-"),
      adGroup: pickLoose(item.adGroup, item.ad_group, item.adGroupName, item.ad_group_name, "-"),
      keyword: keyword || "-",
      matchType: pickLoose(item.matchType, item.match_type, item.keywordMatchType, item.keyword_match_type, ""),
      searchTerm: searchTerm || "-",
      websiteSearchTerms: websiteTerms,
      websiteContext: pickLoose(item.websiteContext, item.website_context, item.context, item.pageContext, item.page_context, ""),
      matchedReportSlug: pickLoose(item.matchedReportSlug, item.matched_report_slug, item.reportSlug, item.report_slug, ""),
      device: pickLoose(item.device, item.deviceType, item.device_type, "-"),
      clicks,
      impressions: Number(pickLoose(item.impressions, item.impression_count, item.impressionCount, 0)) || 0,
      cost,
      leads,
      sales,
      revenue,
      quality: normalizeAdsQuality({ ...item, sales, leads, websiteSearchTerms: websiteTerms }),
      actionSuggestion: pickLoose(item.actionSuggestion, item.action_suggestion, item.suggestion, item.recommendation, ""),
      lastPulledAt: pickLoose(item.lastPulledAt, item.last_pulled_at, item.pulledAt, item.pulled_at, parsed?.lastPulledAt, parsed?.last_pulled_at, ""),
      raw: item,
    };
  });
}


function normalizeWebsiteSearchPayload(payload, key = "website_searches") {
  const parsed = payload && typeof payload.body === "string" ? JSON.parse(payload.body) : payload;
  const rawItems = Array.isArray(parsed?.[key])
    ? parsed[key]
    : key === "website_searches" && Array.isArray(parsed?.websiteSearches)
    ? parsed.websiteSearches
    : key === "matched_website_searches" && Array.isArray(parsed?.matchedWebsiteSearches)
    ? parsed.matchedWebsiteSearches
    : key === "unmatched_website_searches" && Array.isArray(parsed?.unmatchedWebsiteSearches)
    ? parsed.unmatchedWebsiteSearches
    : [];

  return rawItems.map((item, index) => {
    const dateValue = pickLoose(item.date, item.date_key, item.dateKey, item.day, "");
    const timestamp = pickLoose(item.timestamp, item.time, item.createdAt, item.created_at, "");
    const query = pickLoose(item.query, item.websiteSearch, item.website_search, item.search, item.term, "-");
    const matchedGoogleTerms = Array.isArray(item.matched_google_search_terms)
      ? item.matched_google_search_terms
      : Array.isArray(item.matchedGoogleSearchTerms)
      ? item.matchedGoogleSearchTerms
      : toStringList(item.matched_google_search_terms || item.matchedGoogleSearchTerms || "");
    const matchedTrafficIds = Array.isArray(item.matched_traffic_ids)
      ? item.matched_traffic_ids
      : Array.isArray(item.matchedTrafficIds)
      ? item.matchedTrafficIds
      : toStringList(item.matched_traffic_ids || item.matchedTrafficIds || "");
    const matchedGoogleAds = Boolean(
      item.matched_google_ads === true ||
        item.matchedGoogleAds === true ||
        String(item.matched_google_ads || item.matchedGoogleAds || "").toLowerCase() === "true"
    );

    return {
      id: pickLoose(item.website_search_id, item.websiteSearchId, item.id, `${dateValue || "website"}-${timestamp || index}-${index}`),
      date: dateValue,
      dateKey: getDateKey(dateValue || timestamp),
      timestamp,
      query,
      username: pickLoose(item.username, item.name, item.user, ""),
      phone: pickLoose(item.phone, item.mobile, item.user_phone, item.userPhone, ""),
      email: pickLoose(item.email, ""),
      ip: pickLoose(item.ip, item.ip_address, item.ipAddress, ""),
      city: pickLoose(item.city, ""),
      state: pickLoose(item.state, ""),
      country: pickLoose(item.country, ""),
      pincode: pickLoose(item.pincode, item.pin_code, item.postal_code, ""),
      matchedGoogleAds,
      bestMatchScore: Number(pickLoose(item.best_match_score, item.bestMatchScore, 0)) || 0,
      bestMatchConfidence: pickLoose(item.best_match_confidence, item.bestMatchConfidence, matchedGoogleAds ? "matched" : "unmatched"),
      matchedGoogleSearchTerms: matchedGoogleTerms,
      matchedTrafficIds,
      source: pickLoose(item.source, "website_search_log"),
      raw: item,
    };
  });
}


function unwrapApiPayload(payload) {
  if (payload && typeof payload.body === "string") {
    try {
      return JSON.parse(payload.body);
    } catch {
      return payload;
    }
  }
  return payload || {};
}

function firstNonEmptyFromObject(obj = {}, keys = []) {
  const lowerMap = new Map(
    Object.keys(obj || {}).map((key) => [String(key).trim().toLowerCase(), key])
  );

  for (const key of keys) {
    const exact = obj?.[key];
    if (exact !== undefined && exact !== null && exact !== "") return exact;

    const foundKey = lowerMap.get(String(key).trim().toLowerCase());
    if (foundKey) {
      const value = obj?.[foundKey];
      if (value !== undefined && value !== null && value !== "") return value;
    }
  }

  return "";
}

function getSearchExplorerTimestamp(item = {}) {
  const raw = item.raw || item;
  return pickLoose(
    item.timestamp,
    firstNonEmptyFromObject(raw, [
      "timestamp",
      "time",
      "createdAt",
      "created_at",
      "search_time",
      "searchTime",
      "searched_at",
      "searchedAt",
      "date_time",
      "dateTime",
      "datetime",
    ]),
    ""
  );
}

function normalizeSearchExplorerPayload(payload) {
  const parsed = unwrapApiPayload(payload);
  const rawItems = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.items)
    ? parsed.items
    : Array.isArray(parsed?.rows)
    ? parsed.rows
    : Array.isArray(parsed?.searches)
    ? parsed.searches
    : Array.isArray(parsed?.website_searches)
    ? parsed.website_searches
    : Array.isArray(parsed?.websiteSearches)
    ? parsed.websiteSearches
    : Array.isArray(parsed?.data)
    ? parsed.data
    : [];

  const rawColumns = Array.isArray(parsed?.columns)
    ? parsed.columns.map((x) => String(x || "").trim()).filter(Boolean)
    : [];

  const discoveredColumns = [];
  rawItems.forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      if (!discoveredColumns.includes(key)) discoveredColumns.push(key);
    });
  });

  const columns = Array.from(new Set([...rawColumns, ...discoveredColumns])).filter(Boolean);

  const items = rawItems.map((item, index) => {
    const timestamp = pickLoose(
      firstNonEmptyFromObject(item, [
        "timestamp",
        "time",
        "createdAt",
        "created_at",
        "search_time",
        "searchTime",
        "searched_at",
        "searchedAt",
        "date_time",
        "dateTime",
        "datetime",
      ]),
      ""
    );

    const dateValue = pickLoose(
      firstNonEmptyFromObject(item, ["date", "date_key", "dateKey", "day", "search_date", "searchDate"]),
      timestamp,
      ""
    );

    const query = pickLoose(
      firstNonEmptyFromObject(item, [
        "query",
        "websiteSearch",
        "website_search",
        "search",
        "search_term",
        "searchTerm",
        "term",
        "keyword",
        "user_query",
        "userQuery",
      ]),
      "-"
    );

    const city = pickLoose(firstNonEmptyFromObject(item, ["city", "City", "location_city"]), "");
    const state = pickLoose(firstNonEmptyFromObject(item, ["state", "State", "region", "province"]), "");
    const country = pickLoose(firstNonEmptyFromObject(item, ["country", "Country", "country_name"]), "");
    const ip = pickLoose(firstNonEmptyFromObject(item, ["ip", "ip_address", "ipAddress", "client_ip", "clientIp"]), "");
    const pincode = pickLoose(firstNonEmptyFromObject(item, ["pincode", "pin_code", "postal_code", "postalCode", "zip"]), "");
    const phone = pickLoose(firstNonEmptyFromObject(item, ["phone", "mobile", "user_phone", "userPhone", "mobile_number"]), "");
    const email = pickLoose(firstNonEmptyFromObject(item, ["email", "user_email", "userEmail"]), "");
    const device = pickLoose(firstNonEmptyFromObject(item, ["device", "device_type", "deviceType", "platform"]), "");
    const source = pickLoose(firstNonEmptyFromObject(item, ["source", "traffic_source", "trafficSource", "utm_source"]), "website_search_log");

    return {
      id: pickLoose(
        firstNonEmptyFromObject(item, ["website_search_id", "websiteSearchId", "id", "row_id", "rowId"]),
        `${dateValue || "search"}-${timestamp || index}-${index}`
      ),
      date: dateValue,
      dateKey: getDateKey(dateValue || timestamp),
      timestamp,
      query,
      ip,
      city,
      state,
      country,
      pincode,
      phone,
      email,
      device,
      source,
      raw: item,
    };
  });

  return {
    items,
    columns,
    total: Number(parsed?.total || parsed?.count || items.length || 0),
    source: parsed?.source || parsed?.bucket || "website_searches_api",
    lastUpdatedAt: parsed?.lastUpdatedAt || parsed?.last_updated_at || parsed?.generatedAt || parsed?.generated_at || "",
    dateRange: parsed?.dateRange || parsed?.date_range || null,
  };
}

function getRawColumnValue(raw = {}, columnName = "") {
  if (!columnName) return "";
  if (raw?.[columnName] !== undefined && raw?.[columnName] !== null) return raw[columnName];
  const wanted = String(columnName).trim().toLowerCase();
  const foundKey = Object.keys(raw || {}).find((key) => String(key).trim().toLowerCase() === wanted);
  return foundKey ? raw[foundKey] : "";
}

function getSearchExplorerLocation(item = {}) {
  return [item.city, item.state, item.country].filter(Boolean).join(", ") || "Unknown location";
}

function buildSearchExplorerGroupOptions(columns = []) {
  const base = [
    { value: "__none", label: "No grouping" },
    { value: "date", label: "Date" },
    { value: "query", label: "Website search" },
    { value: "ip", label: "IP address" },
    { value: "location", label: "Location" },
    { value: "city", label: "City" },
    { value: "state", label: "State" },
    { value: "country", label: "Country" },
    { value: "pincode", label: "Pincode" },
    { value: "phone", label: "Phone" },
    { value: "email", label: "Email" },
    { value: "device", label: "Device" },
    { value: "source", label: "Source" },
  ];

  const usedLabels = new Set(base.map((x) => x.label.trim().toLowerCase()));
  const rawOptions = (columns || [])
    .filter(Boolean)
    .filter((column) => !usedLabels.has(String(column).trim().toLowerCase()))
    .map((column) => ({ value: `raw:${column}`, label: `Excel column: ${column}` }));

  return [...base, ...rawOptions];
}

function getSearchExplorerGroupValue(item = {}, groupBy = "ip") {
  if (groupBy === "__none") return "All searches";
  if (groupBy === "date") return item.dateKey && item.dateKey !== "unknown-date" ? formatDateGroupLabel(item.dateKey) : "Unknown date";
  if (groupBy === "location") return getSearchExplorerLocation(item);
  if (groupBy?.startsWith("raw:")) {
    const rawHeader = groupBy.slice(4);
    return String(getRawColumnValue(item.raw, rawHeader) || "Blank").trim() || "Blank";
  }
  return String(item?.[groupBy] || "Blank").trim() || "Blank";
}

function getSearchExplorerSortTime(item = {}) {
  const timestamp = getSearchExplorerTimestamp(item);
  const d = timestamp ? new Date(timestamp) : item.date ? new Date(String(item.date).length === 10 ? `${item.date}T00:00:00` : item.date) : null;
  return d && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
}

function groupSearchExplorerItems(items = [], groupBy = "ip") {
  const map = new Map();
  const sorted = [...items].sort((a, b) => getSearchExplorerSortTime(b) - getSearchExplorerSortTime(a));

  sorted.forEach((item) => {
    const label = getSearchExplorerGroupValue(item, groupBy);
    const key = `${groupBy}:${label}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        label,
        items: [],
        uniqueQueries: new Set(),
        uniqueIps: new Set(),
        latestTime: 0,
      });
    }

    const group = map.get(key);
    group.items.push(item);
    if (item.query) group.uniqueQueries.add(normalize(item.query));
    if (item.ip) group.uniqueIps.add(item.ip);
    group.latestTime = Math.max(group.latestTime, getSearchExplorerSortTime(item));
  });

  return Array.from(map.values())
    .map((group) => ({
      ...group,
      uniqueQueryCount: group.uniqueQueries.size,
      uniqueIpCount: group.uniqueIps.size,
    }))
    .sort((a, b) => b.items.length - a.items.length || b.latestTime - a.latestTime || a.label.localeCompare(b.label));
}

function searchExplorerMatches(item = {}, query = "") {
  const q = normalize(query);
  if (!q) return true;

  const values = [
    item.date,
    item.timestamp,
    item.query,
    item.ip,
    item.city,
    item.state,
    item.country,
    item.pincode,
    item.phone,
    item.email,
    item.device,
    item.source,
    ...Object.values(item.raw || {}),
  ];

  return values.map(normalize).some((value) => value.includes(q));
}

function summarizeSearchExplorerItems(items = []) {
  const ips = new Set();
  const locations = new Set();
  const queries = new Set();
  const phones = new Set();
  const emails = new Set();

  items.forEach((item) => {
    if (item.ip) ips.add(item.ip);
    const location = getSearchExplorerLocation(item);
    if (location && location !== "Unknown location") locations.add(location);
    if (item.query && item.query !== "-") queries.add(normalize(item.query));
    if (item.phone) phones.add(item.phone);
    if (item.email) emails.add(normalize(item.email));
  });

  return {
    total: items.length,
    uniqueIps: ips.size,
    uniqueLocations: locations.size,
    uniqueQueries: queries.size,
    knownPhones: phones.size,
    knownEmails: emails.size,
  };
}

function getAdsQualityClass(value) {
  const q = normalize(value).replace(/\s+/g, "-");
  return q ? `st-${q}` : "st-unknown";
}


function groupSalesByMonthAndDate(items) {
  const monthMap = new Map();

  [...(items || [])]
    .sort((a, b) => new Date(b.saleDate || 0) - new Date(a.saleDate || 0))
    .forEach((sale) => {
      const dateKey = sale.dateKey || getDateKey(sale.saleDate);
      const monthKey = getMonthKeyFromDateKey(dateKey);

      if (!monthMap.has(monthKey)) {
        monthMap.set(monthKey, { monthKey, dates: new Map(), totalAmount: 0, count: 0 });
      }

      const month = monthMap.get(monthKey);
      month.totalAmount += toAmountNumber(sale.amount);
      month.count += 1;

      if (!month.dates.has(dateKey)) {
        month.dates.set(dateKey, { dateKey, items: [], totalAmount: 0, count: 0 });
      }

      const dateGroup = month.dates.get(dateKey);
      dateGroup.items.push(sale);
      dateGroup.totalAmount += toAmountNumber(sale.amount);
      dateGroup.count += 1;
    });

  return Array.from(monthMap.values()).map((month) => ({
    monthKey: month.monthKey,
    label: formatMonthGroupLabel(month.monthKey),
    totalAmount: month.totalAmount,
    count: month.count,
    dates: Array.from(month.dates.values()).map((dateGroup) => ({
      ...dateGroup,
      label: formatDateGroupLabel(dateGroup.dateKey),
    })),
  }));
}


const DEFAULT_BULK_REPORT_DRAFT = {
  report_id: "",
  report_name: "",
  slug: "",
  enabled: true,
  keywordsText: "",
  remarks: "",
  segments: [
    {
      id: "seg_market_snapshot",
      heading: "Market Snapshot",
      source_table: "rbrmain-import_export_companies",
      description: "Pulls the latest records from DynamoDB and prints them as a report section.",
      filter_attribute: "",
      filter_operator: "contains",
      filter_value: "",
      columnsText: "company_name, country, product, brands, email, phone, supply_requested",
      row_limit: 25,
    },
  ],
};

function makeBulkReportId() {
  return `bulk_${Math.random().toString(16).slice(2, 10)}`;
}

function makeEmptyBulkSegment(index = 1) {
  return {
    id: `seg_${Math.random().toString(16).slice(2, 8)}`,
    heading: `Segment ${index}`,
    source_table: "",
    description: "",
    filter_attribute: "",
    filter_operator: "contains",
    filter_value: "",
    columnsText: "",
    row_limit: 25,
  };
}

function makeBulkReportDraft() {
  const now = nowIso();
  return {
    ...deepClone(DEFAULT_BULK_REPORT_DRAFT),
    report_id: makeBulkReportId(),
    created_at: now,
    updated_at: now,
    last_updated_date: "Never generated",
  };
}

function listFromText(value = "") {
  if (Array.isArray(value)) return value.map((x) => String(x || "").trim()).filter(Boolean);
  return String(value || "")
    .split(/[|,\n]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeBulkSegment(segment = {}, index = 0) {
  const columns = Array.isArray(segment.columns)
    ? segment.columns
    : listFromText(segment.columnsText || segment.columns_text || segment.column_names || "");

  return {
    id: segment.id || `seg_${index + 1}`,
    heading: segment.heading || segment.title || `Segment ${index + 1}`,
    source_table: segment.source_table || segment.sourceTable || segment.table || "",
    description: segment.description || segment.notes || "",
    filter_attribute: segment.filter_attribute || segment.filterAttribute || "",
    filter_operator: segment.filter_operator || segment.filterOperator || "contains",
    filter_value: segment.filter_value || segment.filterValue || "",
    columns,
    columnsText: columns.join(", "),
    row_limit: Number(segment.row_limit || segment.rowLimit || segment.limit || 25) || 25,
  };
}

function normalizeBulkReport(item = {}, index = 0) {
  const segments = Array.isArray(item.segments) ? item.segments.map(normalizeBulkSegment) : [];
  const keywords = Array.isArray(item.keywords) ? item.keywords : listFromText(item.keywordsText || item.keywords_text || "");
  const reportName = item.report_name || item.reportName || item.title || item.name || "Untitled bulk report";

  return {
    id: item.report_id || item.reportId || item.id || item.slug || `bulk-${index}`,
    report_id: item.report_id || item.reportId || item.id || `bulk-${index}`,
    report_name: reportName,
    slug: item.slug || normalizeSlug(reportName),
    enabled: item.enabled !== false && String(item.status || "").toLowerCase() !== "disabled",
    status: item.status || (item.enabled === false ? "disabled" : "active"),
    keywords,
    keywordsText: keywords.join(", "),
    remarks: item.remarks || item.notes || item.complaints_note || "",
    segments,
    last_updated_date: item.last_updated_date || item.lastUpdatedDate || item.lastGeneratedAt || item.last_generated_at || "Never generated",
    last_run_status: item.last_run_status || item.lastRunStatus || "",
    full_key: item.full_key || item.fullKey || "",
    preview_key: item.preview_key || item.previewKey || "",
    updated_at: item.updated_at || item.updatedAt || "",
    created_at: item.created_at || item.createdAt || "",
    raw: item,
  };
}

function normalizeBulkReportsPayload(payload) {
  const parsed = unwrapApiPayload(payload);
  const rawItems = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.items)
    ? parsed.items
    : Array.isArray(parsed?.reports)
    ? parsed.reports
    : Array.isArray(parsed?.data)
    ? parsed.data
    : [];

  return {
    items: rawItems.map(normalizeBulkReport),
    total: Number(parsed?.total || parsed?.count || rawItems.length || 0),
    source: parsed?.source || "bulk_reports_api",
    lastRunAt: parsed?.lastRunAt || parsed?.last_run_at || "",
    raw: parsed,
  };
}

function bulkDraftToPayload(draft = {}) {
  const reportName = String(draft.report_name || draft.reportName || "").trim();
  const slug = normalizeSlug(draft.slug || reportName);

  return {
    report_id: draft.report_id || draft.id || makeBulkReportId(),
    report_name: reportName,
    slug,
    enabled: draft.enabled !== false,
    keywords: listFromText(draft.keywordsText || draft.keywords || ""),
    remarks: draft.remarks || "",
    segments: (draft.segments || []).map((segment, index) => {
      const normalized = normalizeBulkSegment(segment, index);
      return {
        id: normalized.id,
        heading: normalized.heading,
        source_table: normalized.source_table,
        description: normalized.description,
        filter_attribute: normalized.filter_attribute,
        filter_operator: normalized.filter_operator,
        filter_value: normalized.filter_value,
        columns: listFromText(segment.columnsText || normalized.columns),
        row_limit: Number(normalized.row_limit || 25) || 25,
      };
    }),
  };
}

function formatBulkDate(value) {
  if (!value || value === "Never generated") return "Never generated";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  try {
    return d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return String(value);
  }
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
  const CATALOG_API = import.meta.env.VITE_CATALOG_API || "";
  const SALES_API = import.meta.env.VITE_SALES_API || "";
  const TRAFFIC_INTELLIGENCE_API = import.meta.env.VITE_TRAFFIC_INTELLIGENCE_API || "";
  const GOOGLE_ADS_UPDATE_API = import.meta.env.VITE_GOOGLE_ADS_UPDATE_API || "";
  const WEBSITE_SEARCHES_API = import.meta.env.VITE_WEBSITE_SEARCHES_API || TRAFFIC_INTELLIGENCE_API || "";
  const BULK_REPORTS_API = import.meta.env.VITE_BULK_REPORTS_API || "";
  const SUGGEST_API = "https://vtwyu7hv50.execute-api.ap-south-1.amazonaws.com/default/suggest";
  const SUGGEST_PREVIEW_API = "https://vtwyu7hv50.execute-api.ap-south-1.amazonaws.com/default/RBR_report_pre-signed_URL";

  // Import/Export admin APIs. Add these in Amplify env vars after creating the save/list Lambdas.
  const IMPORT_SEARCH_MAP_SAVE_API = import.meta.env.VITE_IMPORT_SEARCH_MAP_SAVE_API || "";
  const IMPORT_COMPANY_SAVE_API = import.meta.env.VITE_IMPORT_COMPANY_SAVE_API || "";
  const IMPORT_SEARCH_ANALYTICS_API = import.meta.env.VITE_IMPORT_SEARCH_ANALYTICS_API || "";

  const [publishingIds, setPublishingIds] = useState({});
  const [topic, setTopic] = useState("FMCG market report India");
  const [questions, setQuestions] = useState(DEFAULT_QUESTIONS);
  const [activeTab, setActiveTab] = useState("instant");
  const [instantAdminTab, setInstantAdminTab] = useState("generate");
  const [mappingSeed, setMappingSeed] = useState(null);
  const isPrebook = activeTab === "prebook";
  const isCatalog = activeTab === "catalog";
  const isSales = activeTab === "sales";
  const isTrafficIntelligence = activeTab === "traffic-intelligence";
  const isWebsiteSearches = activeTab === "website-searches";
  const isBulkReports = activeTab === "bulk-reports";
  const isInstantAdmin = activeTab === "instant" && instantAdminTab !== "generate";

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
  const [salesItems, setSalesItems] = useState([]);
  const [salesLoading, setSalesLoading] = useState(false);
  const [salesError, setSalesError] = useState("");
  const [salesSearch, setSalesSearch] = useState("");
  const [expandedSaleMonths, setExpandedSaleMonths] = useState({});
  const [expandedSaleDates, setExpandedSaleDates] = useState({});
  const [salesMeta, setSalesMeta] = useState({ total: 0, source: "" });
  const [adsItems, setAdsItems] = useState([]);
  const [websiteSearchItems, setWebsiteSearchItems] = useState([]);
  const [matchedWebsiteSearchItems, setMatchedWebsiteSearchItems] = useState([]);
  const [unmatchedWebsiteSearchItems, setUnmatchedWebsiteSearchItems] = useState([]);
  const [adsTableOpen, setAdsTableOpen] = useState(true);
  const [websiteTableOpen, setWebsiteTableOpen] = useState(false);
  const [adsLoading, setAdsLoading] = useState(false);
  const [adsUpdating, setAdsUpdating] = useState(false);
  const [adsError, setAdsError] = useState("");
  const [adsSearch, setAdsSearch] = useState("");
  const [adsQualityFilter, setAdsQualityFilter] = useState("all");
  const [adsDeviceFilter, setAdsDeviceFilter] = useState("all");
  const [expandedAdsRows, setExpandedAdsRows] = useState({});
  const [adsMeta, setAdsMeta] = useState({ total: 0, source: "", lastPulledAt: "" });
  const [searchExplorerItems, setSearchExplorerItems] = useState([]);
  const [searchExplorerColumns, setSearchExplorerColumns] = useState([]);
  const [searchExplorerLoading, setSearchExplorerLoading] = useState(false);
  const [searchExplorerError, setSearchExplorerError] = useState("");
  const [searchExplorerSearch, setSearchExplorerSearch] = useState("");
  const [searchExplorerGroupBy, setSearchExplorerGroupBy] = useState("ip");
  const [expandedSearchExplorerGroups, setExpandedSearchExplorerGroups] = useState({});
  const [expandedSearchExplorerRows, setExpandedSearchExplorerRows] = useState({});
  const [searchExplorerMeta, setSearchExplorerMeta] = useState({ total: 0, source: "", lastUpdatedAt: "", dateRange: null });
  const [bulkReports, setBulkReports] = useState([]);
  const [bulkReportsLoading, setBulkReportsLoading] = useState(false);
  const [bulkReportsSaving, setBulkReportsSaving] = useState(false);
  const [bulkReportsRunning, setBulkReportsRunning] = useState(false);
  const [bulkReportsError, setBulkReportsError] = useState("");
  const [bulkReportsSearch, setBulkReportsSearch] = useState("");
  const [bulkReportsMeta, setBulkReportsMeta] = useState({ total: 0, source: "", lastRunAt: "" });
  const [bulkDraft, setBulkDraft] = useState(() => makeBulkReportDraft());
  const [bulkSelectedReportId, setBulkSelectedReportId] = useState("");
  const [expandedBulkReports, setExpandedBulkReports] = useState({});
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

  useEffect(() => {
    if (activeTab !== "sales") return;
    loadSales();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "traffic-intelligence") return;
    loadAdsIntelligence();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "website-searches") return;
    loadWebsiteSearches();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "bulk-reports") return;
    loadBulkReports();
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

  const filteredSalesItems = useMemo(() => {
    const q = normalize(salesSearch);
    if (!q) return salesItems;
    return salesItems.filter((sale) =>
      [
        sale.mobile,
        sale.name,
        sale.reportTitle,
        sale.reportId,
        sale.reportType,
        sale.paymentId,
        sale.orderId,
        sale.status,
        sale.saleDate,
        sale.amount,
      ]
        .map(normalize)
        .some((value) => value.includes(q))
    );
  }, [salesItems, salesSearch]);

  const groupedSales = useMemo(() => {
    return groupSalesByMonthAndDate(filteredSalesItems);
  }, [filteredSalesItems]);

  const salesTotalAmount = useMemo(() => {
    return filteredSalesItems.reduce((sum, sale) => sum + toAmountNumber(sale.amount), 0);
  }, [filteredSalesItems]);


  const filteredAdsItems = useMemo(() => {
    const q = normalize(adsSearch);
    const quality = normalize(adsQualityFilter);
    const device = normalize(adsDeviceFilter);
    return adsItems.filter((item) => {
      const matchesSearch =
        !q ||
        [
          item.campaign,
          item.adGroup,
          item.keyword,
          item.searchTerm,
          item.websiteContext,
          item.matchedReportSlug,
          item.device,
          item.quality,
          item.actionSuggestion,
          ...(item.websiteSearchTerms || []),
        ]
          .map(normalize)
          .some((value) => value.includes(q));
      const matchesQuality = quality === "all" ? true : normalize(item.quality) === quality;
      const matchesDevice = device === "all" ? true : normalize(item.device) === device;
      return matchesSearch && matchesQuality && matchesDevice;
    });
  }, [adsItems, adsSearch, adsQualityFilter, adsDeviceFilter]);

  const filteredWebsiteSearchItems = useMemo(() => {
    const q = normalize(adsSearch);
    if (!q) return websiteSearchItems;
    return websiteSearchItems.filter((item) =>
      [
        item.query,
        item.timestamp,
        item.date,
        item.city,
        item.state,
        item.country,
        item.pincode,
        item.ip,
        item.phone,
        item.email,
        item.bestMatchConfidence,
        ...(item.matchedGoogleSearchTerms || []),
      ]
        .map(normalize)
        .some((value) => value.includes(q))
    );
  }, [websiteSearchItems, adsSearch]);

  const filteredMatchedWebsiteSearchItems = useMemo(() => {
    const ids = new Set(filteredWebsiteSearchItems.map((item) => item.id));
    return matchedWebsiteSearchItems.filter((item) => ids.has(item.id));
  }, [matchedWebsiteSearchItems, filteredWebsiteSearchItems]);

  const filteredUnmatchedWebsiteSearchItems = useMemo(() => {
    const ids = new Set(filteredWebsiteSearchItems.map((item) => item.id));
    return unmatchedWebsiteSearchItems.filter((item) => ids.has(item.id));
  }, [unmatchedWebsiteSearchItems, filteredWebsiteSearchItems]);

  const websiteSearchSummary = useMemo(() => {
    return {
      total: filteredWebsiteSearchItems.length,
      matched: filteredMatchedWebsiteSearchItems.length,
      unmatched: filteredUnmatchedWebsiteSearchItems.length,
    };
  }, [filteredWebsiteSearchItems, filteredMatchedWebsiteSearchItems, filteredUnmatchedWebsiteSearchItems]);

  const adsSummary = useMemo(() => {
    return filteredAdsItems.reduce(
      (acc, item) => {
        acc.clicks += Number(item.clicks || 0);
        acc.impressions += Number(item.impressions || 0);
        acc.cost += toAmountNumber(item.cost);
        acc.leads += Number(item.leads || 0);
        acc.sales += Number(item.sales || 0);
        acc.revenue += toAmountNumber(item.revenue);
        acc.websiteSearches += (item.websiteSearchTerms || []).length || (item.websiteContext ? 1 : 0);
        return acc;
      },
      { clicks: 0, impressions: 0, cost: 0, leads: 0, sales: 0, revenue: 0, websiteSearches: 0 }
    );
  }, [filteredAdsItems]);

  const filteredSearchExplorerItems = useMemo(() => {
    return searchExplorerItems.filter((item) => searchExplorerMatches(item, searchExplorerSearch));
  }, [searchExplorerItems, searchExplorerSearch]);

  const searchExplorerGroupOptions = useMemo(() => {
    return buildSearchExplorerGroupOptions(searchExplorerColumns);
  }, [searchExplorerColumns]);

  const groupedSearchExplorerItems = useMemo(() => {
    return groupSearchExplorerItems(filteredSearchExplorerItems, searchExplorerGroupBy);
  }, [filteredSearchExplorerItems, searchExplorerGroupBy]);

  const searchExplorerSummary = useMemo(() => {
    return summarizeSearchExplorerItems(filteredSearchExplorerItems);
  }, [filteredSearchExplorerItems]);


  const filteredBulkReports = useMemo(() => {
    const q = normalize(bulkReportsSearch);
    if (!q) return bulkReports;
    return bulkReports.filter((report) =>
      [
        report.report_name,
        report.slug,
        report.report_id,
        report.status,
        report.remarks,
        ...(report.keywords || []),
        ...(report.segments || []).flatMap((segment) => [
          segment.heading,
          segment.source_table,
          segment.filter_attribute,
          segment.filter_value,
          ...(segment.columns || []),
        ]),
      ]
        .map(normalize)
        .some((value) => value.includes(q))
    );
  }, [bulkReports, bulkReportsSearch]);

  const bulkReportsSummary = useMemo(() => {
    return filteredBulkReports.reduce(
      (acc, report) => {
        acc.total += 1;
        if (report.enabled) acc.enabled += 1;
        else acc.disabled += 1;
        acc.segments += (report.segments || []).length;
        return acc;
      },
      { total: 0, enabled: 0, disabled: 0, segments: 0 }
    );
  }, [filteredBulkReports]);

  const adsQualityOptions = useMemo(() => {
    return ["all", ...Array.from(new Set(adsItems.map((x) => x.quality).filter(Boolean)))];
  }, [adsItems]);

  const adsDeviceOptions = useMemo(() => {
    return ["all", ...Array.from(new Set(adsItems.map((x) => x.device).filter(Boolean)))];
  }, [adsItems]);

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
      const resolvedS3Key = resolvePrebookPdfKey(item, item?.raw || {});

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
      s3Key: resolvePrebookPdfKey(item, statusData),
      pdfKey: resolvePrebookPdfKey(item, statusData),
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

        const instantPdfKey = resolveInstantPdfKey(data);

        upsertHistoryItem(historyId, {
          status: data.status || "unknown",
          statusResponse: data,
          s3Key: instantPdfKey,
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
            s3Key: resolvePrebookPdfKey({ id: historyId, reportId, createdAt: nowIso() }, data || {}),
          pdfKey: resolvePrebookPdfKey({ id: historyId, reportId, createdAt: nowIso() }, data || {}),
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

    const resolvedPdfKey = resolvePrebookPdfKey(item, item.raw || {});
    
    if (!resolvedPdfKey && !item.reportId) {
      throw new Error("No s3Key/reportId available for this pre-book report.");
    }

    const url = new URL(PREBOOK_PRESIGN_API);

    if (resolvedPdfKey) url.searchParams.set("s3Key", resolvedPdfKey);
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
    const finalKey = data?.s3Key || data?.pdfKey || data?.s3_key || data?.pdf_key || resolvedPdfKey || "";

    upsertPrebookItem(item.id, {
      pdfUrl: freshUrl,
      s3Key: finalKey,
      pdfKey: finalKey,
    });

    return {
      ...item,
      pdfUrl: freshUrl,
      s3Key: finalKey,
      pdfKey: finalKey,
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

      const finalS3Key = resolveInstantPdfKey(statusData);

      if (!finalS3Key) {
        throw new Error(
          "Status API did not return the instant report S3 key. Please check the instant worker/status Lambda response."
        );
      }

      if (!finalS3Key.startsWith("instant_reports/")) {
        throw new Error(
          `Instant report S3 key must start with instant_reports/. Received: ${finalS3Key}`
        );
      }

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
                  title: `Segment ${i + 1}`,
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
      
      const resolvedStatusPdfKey = resolvePrebookPdfKey(
        { id: historyId, reportId, createdAt: nowIso() },
        statusData || {}
      );

      const finalItem = {
        id: historyId,
        reportId: statusData.reportId || reportId,
        status: statusData.status || "completed",
        s3Key: resolvedStatusPdfKey,
        pdfKey: resolvedStatusPdfKey,
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
          s3Key: resolvedStatusPdfKey || finalItem.s3Key || finalItem.pdfKey || "",
          pdfKey: resolvedStatusPdfKey || finalItem.pdfKey || finalItem.s3Key || "",
        });
        freshPdfUrl = refreshed?.pdfUrl || "";
      }
      
      upsertPrebookItem(historyId, {
        reportName: statusData.reportName || reportDisplayName,
        title: statusData.reportName || reportDisplayName,
        reportId: statusData.reportId || reportId,
        status: statusData.status || "completed",
        s3Key: resolvedStatusPdfKey,
        pdfKey: resolvedStatusPdfKey,
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

    const q = String(searchTerm || "").trim();
    const hasCatalogApi = Boolean(CATALOG_API && !String(CATALOG_API).includes("example.com"));

    try {
      // Until a dedicated catalog-list Lambda is connected, this tab can still be useful
      // by reading from the live /suggest API that already scans rbrmain-finalReportsCatalog.
      if (!hasCatalogApi) {
        if (!q) {
          setCatalogItems([]);
          setCatalogMeta({ total: 0, source: "live_suggest_fallback" });
          setCatalogError("Enter a search term to inspect catalog records using the live /suggest API, or set VITE_CATALOG_API for full catalog listing.");
          return;
        }

        const { res, data } = await fetchJson(SUGGEST_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q, limit: 25 }),
        });

        if (!res.ok) {
          throw new Error(buildErrorMessage(res, data, "Suggest API catalog fallback failed"));
        }

        const parsed = data && typeof data.body === "string" ? JSON.parse(data.body) : data;
        const items = normalizeCatalogItems(parsed);
        setCatalogItems(items);
        setCatalogMeta({
          total: Number(parsed?.total || items.length || 0),
          source: "live_suggest_fallback",
        });
        return;
      }

      const payload = {
        query: q,
        q,
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

      const parsed = data && typeof data.body === "string" ? JSON.parse(data.body) : data;
      const items = normalizeCatalogItems(parsed);
      setCatalogItems(items);
      setCatalogMeta({
        total: Number(parsed?.total || items.length || 0),
        source: parsed?.source || "catalog_api",
      });
    } catch (e) {
      setCatalogItems([]);
      setCatalogMeta({ total: 0, source: "" });
      setCatalogError(e?.message || "Failed to load catalog");
    } finally {
      setCatalogLoading(false);
    }
  }

  async function loadSales() {
    setSalesLoading(true);
    setSalesError("");

    if (!SALES_API) {
      setSalesItems([]);
      setSalesMeta({ total: 0, source: "" });
      setSalesLoading(false);
      setSalesError("Missing env var: VITE_SALES_API. Add your sales-list Lambda/API Gateway URL in Amplify env vars and redeploy.");
      return;
    }

    try {
      const url = new URL(SALES_API, window.location.origin);
      url.searchParams.set("limit", "1000");
      url.searchParams.set("_ts", String(Date.now()));

      const { res, data } = await fetchJson(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        cache: "no-store",
      });

      const parsed = parseJsonRecursively(data?.body ?? data);
      setLastApiResponse(parsed);

      if (!res.ok || data?.ok === false || parsed?.ok === false) {
        throw new Error(buildErrorMessage(res, parsed || data, "Sales API failed"));
      }

      const items = normalizeSalesPayload(data);
      setSalesItems(items);
      setSalesMeta({
        total: Number(parsed?.total || parsed?.count || items.length || 0),
        source: parsed?.source || data?.source || "sales_api",
        fetchedAt: new Date().toISOString(),
      });
    } catch (e) {
      setSalesItems([]);
      setSalesMeta({ total: 0, source: "" });
      setSalesError(e?.message || "Failed to load sales");
    } finally {
      setSalesLoading(false);
    }
  }

  function toggleSaleMonth(monthKey) {
    setExpandedSaleMonths((prev) => ({
      ...prev,
      [monthKey]: prev[monthKey] !== undefined ? !prev[monthKey] : false,
    }));
  }

  function toggleSaleDate(dateKey) {
    setExpandedSaleDates((prev) => ({
      ...prev,
      [dateKey]: prev[dateKey] !== undefined ? !prev[dateKey] : false,
    }));
  }

  async function loadAdsIntelligence() {
    setAdsLoading(true);
    setAdsError("");

    if (!TRAFFIC_INTELLIGENCE_API) {
      setAdsItems([]);
      setWebsiteSearchItems([]);
      setMatchedWebsiteSearchItems([]);
      setUnmatchedWebsiteSearchItems([]);
      setAdsMeta({ total: 0, source: "", lastPulledAt: "" });
      setAdsLoading(false);
      setAdsError("Missing env var: VITE_TRAFFIC_INTELLIGENCE_API. Add your traffic-intelligence list Lambda/API Gateway URL in Amplify env vars and redeploy.");
      return;
    }

    try {
      const { res, data } = await fetchJson(TRAFFIC_INTELLIGENCE_API, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok || data?.ok === false) {
        throw new Error(buildErrorMessage(res, data, "Traffic Intelligence API failed"));
      }

      const items = normalizeAdsIntelligencePayload(data);
      const websiteSearches = normalizeWebsiteSearchPayload(data, "website_searches");
      const matchedWebsiteSearches = normalizeWebsiteSearchPayload(data, "matched_website_searches");
      const unmatchedWebsiteSearches = normalizeWebsiteSearchPayload(data, "unmatched_website_searches");
      setAdsItems(items);
      setWebsiteSearchItems(websiteSearches);
      setMatchedWebsiteSearchItems(matchedWebsiteSearches);
      setUnmatchedWebsiteSearchItems(unmatchedWebsiteSearches);
      setAdsMeta({
        total: Number(data?.total || data?.count || items.length || 0),
        source: data?.source || "ads_intelligence_api",
        lastPulledAt: data?.lastPulledAt || data?.last_pulled_at || items.find((x) => x.lastPulledAt)?.lastPulledAt || "",
      });
    } catch (e) {
      setAdsItems([]);
      setWebsiteSearchItems([]);
      setMatchedWebsiteSearchItems([]);
      setUnmatchedWebsiteSearchItems([]);
      setAdsMeta({ total: 0, source: "", lastPulledAt: "" });
      setAdsError(e?.message || "Failed to load Traffic Intelligence data");
    } finally {
      setAdsLoading(false);
    }
  }

  async function loadWebsiteSearches() {
    setSearchExplorerLoading(true);
    setSearchExplorerError("");

    if (!WEBSITE_SEARCHES_API) {
      setSearchExplorerItems([]);
      setSearchExplorerColumns([]);
      setSearchExplorerMeta({ total: 0, source: "", lastUpdatedAt: "", dateRange: null });
      setSearchExplorerLoading(false);
      setSearchExplorerError(
        "Missing env var: VITE_WEBSITE_SEARCHES_API. You can temporarily set it to the existing Traffic Intelligence list API if that response already includes website_searches."
      );
      return;
    }

    try {
      const { res, data } = await fetchJson(WEBSITE_SEARCHES_API, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok || data?.ok === false) {
        throw new Error(buildErrorMessage(res, data, "Website Searches API failed"));
      }

      const normalized = normalizeSearchExplorerPayload(data);
      setSearchExplorerItems(normalized.items);
      setSearchExplorerColumns(normalized.columns);
      setSearchExplorerMeta({
        total: normalized.total,
        source: normalized.source,
        lastUpdatedAt: normalized.lastUpdatedAt,
        dateRange: normalized.dateRange,
      });
    } catch (e) {
      setSearchExplorerItems([]);
      setSearchExplorerColumns([]);
      setSearchExplorerMeta({ total: 0, source: "", lastUpdatedAt: "", dateRange: null });
      setSearchExplorerError(e?.message || "Failed to load website searches");
    } finally {
      setSearchExplorerLoading(false);
    }
  }

  async function updateGoogleAdsDetails() {
    setAdsUpdating(true);
    setAdsError("");
  
    if (!GOOGLE_ADS_UPDATE_API) {
      setAdsUpdating(false);
      setAdsError(
        "Missing env var: VITE_GOOGLE_ADS_UPDATE_API. Add your manual Google Ads pull Lambda/API Gateway URL in Amplify env vars and redeploy."
      );
      return;
    }
  
    try {
      const payload = {
        requestedAt: nowIso(),
        source: "employee_traffic_intelligence_tab",
      };
  
      console.log("GOOGLE ADS UPDATE URL =", GOOGLE_ADS_UPDATE_API);
      console.log("GOOGLE ADS UPDATE PAYLOAD =", payload);
  
      const res = await fetch(GOOGLE_ADS_UPDATE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
  
      const text = await res.text();
  
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }
  
      console.log("GOOGLE ADS UPDATE STATUS =", res.status);
      console.log("GOOGLE ADS UPDATE RESPONSE TEXT =", text);
      console.log("GOOGLE ADS UPDATE RESPONSE DATA =", data);
  
      if (!res.ok || data?.ok === false) {
        throw new Error(
          data?.error ||
            data?.message ||
            data?.details ||
            data?.raw ||
            `Google Ads update failed. HTTP ${res.status}`
        );
      }
  
      const returnedItems = normalizeAdsIntelligencePayload(data);
      const returnedWebsiteSearches = normalizeWebsiteSearchPayload(data, "website_searches");
      const returnedMatchedWebsiteSearches = normalizeWebsiteSearchPayload(data, "matched_website_searches");
      const returnedUnmatchedWebsiteSearches = normalizeWebsiteSearchPayload(data, "unmatched_website_searches");
  
      if (returnedItems.length || returnedWebsiteSearches.length) {
        setAdsItems(returnedItems);
        setWebsiteSearchItems(returnedWebsiteSearches);
        setMatchedWebsiteSearchItems(returnedMatchedWebsiteSearches);
        setUnmatchedWebsiteSearchItems(returnedUnmatchedWebsiteSearches);
  
        setAdsMeta({
          total: Number(data?.total || data?.count || returnedItems.length || 0),
          source: data?.source || "google_ads_update_api",
          lastPulledAt: data?.lastPulledAt || data?.last_pulled_at || nowIso(),
        });
      } else {
        await loadAdsIntelligence();
      }
  
      setToast("Google Ads details updated ✅");
    } catch (e) {
      console.error("GOOGLE ADS UPDATE ERROR =", e);
      setAdsError(e?.message || "Google Ads update failed");
      setToast("Google Ads update failed");
    } finally {
      setAdsUpdating(false);
    }
  }

  function toggleAdsRow(rowId) {
    setExpandedAdsRows((prev) => ({
      ...prev,
      [rowId]: !prev[rowId],
    }));
  }

  function toggleSearchExplorerGroup(groupKey) {
    setExpandedSearchExplorerGroups((prev) => ({
      ...prev,
      [groupKey]: prev[groupKey] !== undefined ? !prev[groupKey] : false,
    }));
  }

  function maximizeAllSearchExplorerGroups() {
    const next = {};
    groupedSearchExplorerItems.forEach((group) => {
      next[group.key] = true;
    });
    setExpandedSearchExplorerGroups(next);
  }

  function minimizeAllSearchExplorerGroups() {
    const next = {};
    groupedSearchExplorerItems.forEach((group) => {
      next[group.key] = false;
    });
    setExpandedSearchExplorerGroups(next);
  }

  function toggleSearchExplorerRow(rowId) {
    setExpandedSearchExplorerRows((prev) => ({
      ...prev,
      [rowId]: !prev[rowId],
    }));
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


  function ensureBulkReportsApi() {
    if (!BULK_REPORTS_API) {
      setBulkReportsError("Missing env var: VITE_BULK_REPORTS_API. Add your bulk reports admin Lambda/API Gateway URL in Amplify env vars and redeploy.");
      return false;
    }
    return true;
  }

  async function callBulkReportsApi(action, payload = {}) {
    if (!ensureBulkReportsApi()) return null;

    const { res, data } = await fetchJson(BULK_REPORTS_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });

    if (!res.ok || data?.ok === false) {
      throw new Error(buildErrorMessage(res, data, `Bulk Reports API failed: ${action}`));
    }

    return data;
  }

  async function loadBulkReports() {
    setBulkReportsLoading(true);
    setBulkReportsError("");

    if (!BULK_REPORTS_API) {
      setBulkReports([]);
      setBulkReportsMeta({ total: 0, source: "", lastRunAt: "" });
      setBulkReportsLoading(false);
      setBulkReportsError("Missing env var: VITE_BULK_REPORTS_API. Add your bulk reports admin Lambda/API Gateway URL in Amplify env vars and redeploy.");
      return;
    }

    try {
      const data = await callBulkReportsApi("list");
      const normalized = normalizeBulkReportsPayload(data);
      setBulkReports(normalized.items);
      setBulkReportsMeta({
        total: normalized.total,
        source: normalized.source,
        lastRunAt: normalized.lastRunAt,
      });
    } catch (e) {
      setBulkReports([]);
      setBulkReportsMeta({ total: 0, source: "", lastRunAt: "" });
      setBulkReportsError(e?.message || "Failed to load bulk reports");
    } finally {
      setBulkReportsLoading(false);
    }
  }

  function resetBulkDraft() {
    setBulkDraft(makeBulkReportDraft());
    setBulkSelectedReportId("");
  }

  function editBulkReport(report) {
    setBulkSelectedReportId(report.report_id);
    setBulkDraft(deepClone(report));
    setExpandedBulkReports((prev) => ({ ...prev, [report.report_id]: true }));
  }

  function updateBulkDraftField(key, value) {
    setBulkDraft((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "report_name" && !prev.slug) {
        next.slug = normalizeSlug(value);
      }
      return next;
    });
  }

  function updateBulkDraftSegment(index, key, value) {
    setBulkDraft((prev) => ({
      ...prev,
      segments: (prev.segments || []).map((segment, i) =>
        i === index ? { ...segment, [key]: value } : segment
      ),
    }));
  }

  function addBulkDraftSegment() {
    setBulkDraft((prev) => ({
      ...prev,
      segments: [...(prev.segments || []), makeEmptyBulkSegment((prev.segments || []).length + 1)],
    }));
  }

  function removeBulkDraftSegment(index) {
    setBulkDraft((prev) => ({
      ...prev,
      segments: (prev.segments || []).filter((_, i) => i !== index),
    }));
  }

  async function saveBulkReportDraft() {
    setBulkReportsSaving(true);
    setBulkReportsError("");

    try {
      const payload = bulkDraftToPayload(bulkDraft);
      if (!payload.report_name) throw new Error("Report name is required.");
      if (!payload.slug) throw new Error("Report slug is required.");
      if (!payload.segments.length) throw new Error("Add at least one segment.");
      const missingTable = payload.segments.find((segment) => !segment.source_table);
      if (missingTable) throw new Error(`DynamoDB table missing for segment: ${missingTable.heading}`);

      const data = await callBulkReportsApi("save", { report: payload });
      const saved = normalizeBulkReport(data?.report || payload);
      setBulkReports((prev) => {
        const exists = prev.some((r) => r.report_id === saved.report_id);
        return exists ? prev.map((r) => (r.report_id === saved.report_id ? saved : r)) : [saved, ...prev];
      });
      setBulkSelectedReportId(saved.report_id);
      setBulkDraft(saved);
      setToast("Bulk report saved ✅");
    } catch (e) {
      setBulkReportsError(e?.message || "Failed to save bulk report");
    } finally {
      setBulkReportsSaving(false);
    }
  }

  async function toggleBulkReport(report) {
    setBulkReportsSaving(true);
    setBulkReportsError("");
    try {
      const data = await callBulkReportsApi("toggle", {
        report_id: report.report_id,
        enabled: !report.enabled,
      });
      const updated = normalizeBulkReport(data?.report || { ...report, enabled: !report.enabled });
      setBulkReports((prev) => prev.map((r) => (r.report_id === updated.report_id ? updated : r)));
      if (bulkSelectedReportId === updated.report_id) setBulkDraft(updated);
      setToast(updated.enabled ? "Report enabled ✅" : "Report disabled");
    } catch (e) {
      setBulkReportsError(e?.message || "Failed to update report status");
    } finally {
      setBulkReportsSaving(false);
    }
  }

  async function deleteBulkReport(report) {
    setBulkReportsSaving(true);
    setBulkReportsError("");
    try {
      await callBulkReportsApi("delete", { report_id: report.report_id });
      setBulkReports((prev) => prev.filter((r) => r.report_id !== report.report_id));
      if (bulkSelectedReportId === report.report_id) resetBulkDraft();
      setToast("Bulk report deleted");
    } catch (e) {
      setBulkReportsError(e?.message || "Failed to delete bulk report");
    } finally {
      setBulkReportsSaving(false);
    }
  }

  async function runBulkReport(report) {
    setBulkReportsRunning(true);
    setBulkReportsError("");
    try {
      const data = await callBulkReportsApi("run_one", { report_id: report.report_id });
      const updated = normalizeBulkReport(data?.report || data?.item || report);
      setBulkReports((prev) => prev.map((r) => (r.report_id === updated.report_id ? updated : r)));
      if (bulkSelectedReportId === updated.report_id) setBulkDraft(updated);
      setBulkReportsMeta((prev) => ({ ...prev, lastRunAt: data?.lastRunAt || data?.last_run_at || nowIso() }));
      setToast("Report regenerated and published ✅");
    } catch (e) {
      setBulkReportsError(e?.message || "Failed to regenerate report");
    } finally {
      setBulkReportsRunning(false);
    }
  }

  async function runEnabledBulkReports() {
    setBulkReportsRunning(true);
    setBulkReportsError("");
    try {
      const data = await callBulkReportsApi("run_enabled", { requestedAt: nowIso() });
      const normalized = normalizeBulkReportsPayload(data);
      if (normalized.items.length) setBulkReports(normalized.items);
      setBulkReportsMeta({
        total: normalized.total || bulkReports.length,
        source: normalized.source || "bulk_reports_api",
        lastRunAt: data?.lastRunAt || data?.last_run_at || nowIso(),
      });
      setToast(`Bulk update completed ✅ ${data?.updated_count ?? normalized.items.length ?? 0} report(s)`);
      await loadBulkReports();
    } catch (e) {
      setBulkReportsError(e?.message || "Failed to run enabled bulk reports");
    } finally {
      setBulkReportsRunning(false);
    }
  }

  function toggleBulkReportExpanded(reportId) {
    setExpandedBulkReports((prev) => ({ ...prev, [reportId]: !prev[reportId] }));
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
              <button
                type="button"
                className="chipPill"
                onClick={() => setActiveTab("sales")}
                style={{
                  border:
                    activeTab === "sales"
                      ? "1px solid rgba(245,158,11,0.48)"
                      : "1px solid rgba(255,255,255,0.14)",
                  background:
                    activeTab === "sales" ? "rgba(245,158,11,0.16)" : "rgba(255,255,255,0.08)",
                  color:
                    activeTab === "sales"
                      ? "rgba(254,243,199,0.98)"
                      : "rgba(255,255,255,0.88)",
                }}
              >
                Sales
              </button>
              <button
                type="button"
                className="chipPill"
                onClick={() => setActiveTab("traffic-intelligence")}
                style={{
                  border:
                    activeTab === "traffic-intelligence"
                      ? "1px solid rgba(14,165,233,0.48)"
                      : "1px solid rgba(255,255,255,0.14)",
                  background:
                    activeTab === "traffic-intelligence" ? "rgba(14,165,233,0.16)" : "rgba(255,255,255,0.08)",
                  color:
                    activeTab === "traffic-intelligence"
                      ? "rgba(224,242,254,0.98)"
                      : "rgba(255,255,255,0.88)",
                }}
              >
                Traffic Intelligence
              </button>
              <button
                type="button"
                className="chipPill"
                onClick={() => setActiveTab("website-searches")}
                style={{
                  border:
                    activeTab === "website-searches"
                      ? "1px solid rgba(34,197,94,0.48)"
                      : "1px solid rgba(255,255,255,0.14)",
                  background:
                    activeTab === "website-searches" ? "rgba(34,197,94,0.16)" : "rgba(255,255,255,0.08)",
                  color:
                    activeTab === "website-searches"
                      ? "rgba(220,252,231,0.98)"
                      : "rgba(255,255,255,0.88)",
                }}
              >
                Website Searches
              </button>
              <button
                type="button"
                className="chipPill"
                onClick={() => setActiveTab("bulk-reports")}
                style={{
                  border:
                    activeTab === "bulk-reports"
                      ? "1px solid rgba(99,102,241,0.54)"
                      : "1px solid rgba(255,255,255,0.14)",
                  background:
                    activeTab === "bulk-reports" ? "rgba(99,102,241,0.18)" : "rgba(255,255,255,0.08)",
                  color:
                    activeTab === "bulk-reports"
                      ? "rgba(224,231,255,0.98)"
                      : "rgba(255,255,255,0.88)",
                }}
              >
                Bulk Reports
              </button>
            </div>

            {activeTab === "instant" ? (
              <>
                <div
                  style={{
                    marginTop: 10,
                    padding: "10px 12px",
                    border: "1px solid rgba(255,255,255,0.10)",
                    borderRadius: 18,
                    background: "rgba(255,255,255,0.045)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "rgba(255,255,255,0.48)",
                      margin: "0 0 8px 4px",
                      fontWeight: 800,
                    }}
                  >
                    Instant Report Work Desk tools
                  </div>

                  <div className="quickChips" style={{ marginTop: 0, gap: 8 }}>
                    {[
                      ["generate", "Generate Report"],
                      ["mapping", "Search Term Mapping"],
                      ["companies", "Importer Database"],
                      ["analytics", "Search Analytics"],
                    ].map(([key, label]) => (
                      <button
                        key={key}
                        className="chipPill"
                        onClick={() => setInstantAdminTab(key)}
                        type="button"
                        style={{
                          fontSize: 12,
                          padding: "7px 11px",
                          borderRadius: 12,
                          border:
                            instantAdminTab === key
                              ? "1px solid rgba(96,165,250,0.48)"
                              : "1px solid rgba(255,255,255,0.10)",
                          background:
                            instantAdminTab === key
                              ? "linear-gradient(180deg, rgba(37,99,235,0.22), rgba(37,99,235,0.10))"
                              : "rgba(255,255,255,0.035)",
                          color:
                            instantAdminTab === key
                              ? "rgba(219,234,254,0.98)"
                              : "rgba(255,255,255,0.66)",
                          boxShadow:
                            instantAdminTab === key
                              ? "inset 0 -2px 0 rgba(96,165,250,0.55)"
                              : "none",
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {QUICK_TOPICS.length ? (
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
              </>
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

        <div className={clsx("body", (leftHidden || isPrebook || isCatalog || isSales || isTrafficIntelligence || isWebsiteSearches || isBulkReports || isInstantAdmin) && "bodyFull")}>
          {!leftHidden && !isPrebook && !isCatalog && !isSales && !isTrafficIntelligence && !isWebsiteSearches && !isBulkReports && !isInstantAdmin ? (
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
            {isBulkReports ? (
              <BulkReportsPanel
                reports={filteredBulkReports}
                summary={bulkReportsSummary}
                loading={bulkReportsLoading}
                saving={bulkReportsSaving}
                running={bulkReportsRunning}
                error={bulkReportsError}
                search={bulkReportsSearch}
                setSearch={setBulkReportsSearch}
                meta={bulkReportsMeta}
                draft={bulkDraft}
                selectedReportId={bulkSelectedReportId}
                updateDraftField={updateBulkDraftField}
                updateDraftSegment={updateBulkDraftSegment}
                addDraftSegment={addBulkDraftSegment}
                removeDraftSegment={removeBulkDraftSegment}
                saveDraft={saveBulkReportDraft}
                resetDraft={resetBulkDraft}
                editReport={editBulkReport}
                deleteReport={deleteBulkReport}
                toggleReport={toggleBulkReport}
                runReport={runBulkReport}
                runEnabledReports={runEnabledBulkReports}
                loadReports={loadBulkReports}
                expandedReports={expandedBulkReports}
                toggleExpanded={toggleBulkReportExpanded}
                copyToClipboard={copyToClipboard}
              />
            ) : isWebsiteSearches ? (
              <WebsiteSearchesPanel
                items={filteredSearchExplorerItems}
                groupedItems={groupedSearchExplorerItems}
                columns={searchExplorerColumns}
                summary={searchExplorerSummary}
                loading={searchExplorerLoading}
                error={searchExplorerError}
                search={searchExplorerSearch}
                setSearch={setSearchExplorerSearch}
                groupBy={searchExplorerGroupBy}
                setGroupBy={setSearchExplorerGroupBy}
                groupOptions={searchExplorerGroupOptions}
                expandedGroups={expandedSearchExplorerGroups}
                expandedRows={expandedSearchExplorerRows}
                toggleGroup={toggleSearchExplorerGroup}
                toggleRow={toggleSearchExplorerRow}
                maximizeAllGroups={maximizeAllSearchExplorerGroups}
                minimizeAllGroups={minimizeAllSearchExplorerGroups}
                meta={searchExplorerMeta}
                loadWebsiteSearches={loadWebsiteSearches}
                copyToClipboard={copyToClipboard}
              />
            ) : isTrafficIntelligence ? (
              <AdsIntelligencePanel
                adsItems={filteredAdsItems}
                websiteSearchItems={filteredWebsiteSearchItems}
                matchedWebsiteSearchItems={filteredMatchedWebsiteSearchItems}
                unmatchedWebsiteSearchItems={filteredUnmatchedWebsiteSearchItems}
                websiteSearchSummary={websiteSearchSummary}
                adsTableOpen={adsTableOpen}
                setAdsTableOpen={setAdsTableOpen}
                websiteTableOpen={websiteTableOpen}
                setWebsiteTableOpen={setWebsiteTableOpen}
                adsSummary={adsSummary}
                adsLoading={adsLoading}
                adsUpdating={adsUpdating}
                adsError={adsError}
                adsSearch={adsSearch}
                setAdsSearch={setAdsSearch}
                adsQualityFilter={adsQualityFilter}
                setAdsQualityFilter={setAdsQualityFilter}
                adsDeviceFilter={adsDeviceFilter}
                setAdsDeviceFilter={setAdsDeviceFilter}
                adsQualityOptions={adsQualityOptions}
                adsDeviceOptions={adsDeviceOptions}
                adsMeta={adsMeta}
                loadAdsIntelligence={loadAdsIntelligence}
                updateGoogleAdsDetails={updateGoogleAdsDetails}
                expandedAdsRows={expandedAdsRows}
                toggleAdsRow={toggleAdsRow}
                copyToClipboard={copyToClipboard}
              />
            ) : isSales ? (
              <SalesPanel
                groupedSales={groupedSales}
                salesItems={filteredSalesItems}
                allSalesCount={salesItems.length}
                salesTotalAmount={salesTotalAmount}
                salesLoading={salesLoading}
                salesError={salesError}
                salesSearch={salesSearch}
                setSalesSearch={setSalesSearch}
                loadSales={loadSales}
                expandedSaleMonths={expandedSaleMonths}
                expandedSaleDates={expandedSaleDates}
                toggleSaleMonth={toggleSaleMonth}
                toggleSaleDate={toggleSaleDate}
                salesMeta={salesMeta}
                rawSalesResponse={lastApiResponse}
                copyToClipboard={copyToClipboard}
              />
            ) : isCatalog ? (
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
            ) : isInstantAdmin ? (
              <InstantImportExportAdminPanel
                mode={instantAdminTab}
                searchMapSaveApi={IMPORT_SEARCH_MAP_SAVE_API}
                companySaveApi={IMPORT_COMPANY_SAVE_API}
                analyticsApi={IMPORT_SEARCH_ANALYTICS_API}
                mappingSeed={mappingSeed}
                clearMappingSeed={() => setMappingSeed(null)}
                openMappingWithSeed={(seed) => {
                  setMappingSeed(seed);
                  setInstantAdminTab("mapping");
                }}
                setToast={setToast}
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

              {!isPrebook && !isCatalog && !isSales && !isTrafficIntelligence && !isWebsiteSearches && !isBulkReports && !isInstantAdmin ? (
                <div className="card glass" style={{ marginBottom: 12, width: "100%" }}>
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
              ) : null}

            {!isCatalog && !isSales && !isTrafficIntelligence && !isWebsiteSearches && !isInstantAdmin ? (
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
          {isSales
            ? "Tip: Expand a month, then expand a sale date to audit each purchase with customer and report details."
            : isBulkReports
            ? "Tip: Keep enabled reports small enough for one Lambda run, then schedule the same API later if you want automatic refresh."
            : isCatalog
            ? "Tip: Use this tab to compare catalog records against live /suggest output and improve relevance."
            : isInstantAdmin
            ? "Tip: Keep search mappings curated. They control which importer categories appear in instant reports."
            : "Tip: Generate 2–3 reports with small prompt changes and compare output quality."}
        </footer>
      </div>
    </div>
  );
}


function BulkReportsPanel({
  reports,
  summary,
  loading,
  saving,
  running,
  error,
  search,
  setSearch,
  meta,
  draft,
  selectedReportId,
  updateDraftField,
  updateDraftSegment,
  addDraftSegment,
  removeDraftSegment,
  saveDraft,
  resetDraft,
  editReport,
  deleteReport,
  toggleReport,
  runReport,
  runEnabledReports,
  loadReports,
  expandedReports,
  toggleExpanded,
  copyToClipboard,
}) {
  const normalizedDraftSlug = normalizeSlug(draft?.slug || draft?.report_name || "");

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div
        className="card glass"
        style={{
          border: "1px solid rgba(99,102,241,0.30)",
          background: "rgba(10,12,24,0.62)",
        }}
      >
        <div className="cardTitleRow" style={{ alignItems: "flex-start", gap: 12 }}>
          <div>
            <div className="cardTitle">Bulk Reports Updater</div>
            <div className="mutedSmall" style={{ marginTop: 4 }}>
              Maintain production-ready report PDFs from DynamoDB tables and publish them into the same catalog used by website suggestions.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button className="btnSecondary" type="button" onClick={loadReports} disabled={loading || running || saving}>
              {loading ? "Refreshing…" : "Refresh list"}
            </button>
            <button className="btn" type="button" onClick={runEnabledReports} disabled={running || saving || loading}>
              {running ? "Updating reports…" : "Run all enabled reports"}
            </button>
          </div>
        </div>

        <div className="statsGrid" style={{ marginTop: 14 }}>
          <div className="statCard"><div className="mutedSmall">Reports shown</div><div className="statValue">{summary.total}</div></div>
          <div className="statCard"><div className="mutedSmall">Enabled</div><div className="statValue">{summary.enabled}</div></div>
          <div className="statCard"><div className="mutedSmall">Disabled</div><div className="statValue">{summary.disabled}</div></div>
          <div className="statCard"><div className="mutedSmall">Segments</div><div className="statValue">{summary.segments}</div></div>
        </div>

        <div className="mutedSmall" style={{ marginTop: 10 }}>
          API source: <span className="mono">{meta.source || "not connected"}</span>
          {meta.lastRunAt ? <> • Last run: <span className="mono">{formatBulkDate(meta.lastRunAt)}</span></> : null}
        </div>
        {error ? <div className="errorBox" style={{ marginTop: 12 }}>Error: {error}</div> : null}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(360px, 0.95fr) minmax(520px, 1.3fr)",
          gap: 14,
          alignItems: "start",
        }}
      >
        <section className="card glass" style={{ border: "1px solid rgba(99,102,241,0.24)", background: "rgba(255,255,255,0.045)" }}>
          <div className="cardTitleRow">
            <div>
              <div className="cardTitle">{selectedReportId ? "Edit bulk report" : "Create bulk report"}</div>
              <div className="mutedSmall">Define the report name, suggestion slug, keywords, and source tables for each segment.</div>
            </div>
            <button className="linkBtn" type="button" onClick={resetDraft}>New</button>
          </div>

          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            <div>
              <label className="label">Report name</label>
              <input
                className="input"
                value={draft.report_name || ""}
                onChange={(e) => updateDraftField("report_name", e.target.value)}
                placeholder="e.g., Readymade Garments Importers in Malaysia"
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 0.75fr", gap: 10 }}>
              <div>
                <label className="label">Suggestion slug / PDF name</label>
                <input
                  className="input"
                  value={draft.slug || ""}
                  onChange={(e) => updateDraftField("slug", normalizeSlug(e.target.value))}
                  placeholder="readymade_garments_malaysia"
                />
                <div className="mutedSmall" style={{ marginTop: 5 }}>
                  Final keys: <span className="mono">{normalizedDraftSlug || "slug"}.pdf</span> and <span className="mono">{normalizedDraftSlug || "slug"}_preview.pdf</span>
                </div>
              </div>

              <div>
                <label className="label">Status</label>
                <select
                  className="input"
                  value={draft.enabled === false ? "disabled" : "enabled"}
                  onChange={(e) => updateDraftField("enabled", e.target.value === "enabled")}
                >
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
            </div>

            <div>
              <label className="label">Suggestion keywords</label>
              <textarea
                className="textarea"
                rows={2}
                value={draft.keywordsText || ""}
                onChange={(e) => updateDraftField("keywordsText", e.target.value)}
                placeholder="Comma or line separated: garments, apparel buyers, Malaysia importers"
              />
            </div>

            <div>
              <label className="label">Admin remarks / complaint note</label>
              <textarea
                className="textarea"
                rows={2}
                value={draft.remarks || ""}
                onChange={(e) => updateDraftField("remarks", e.target.value)}
                placeholder="Use this to record why a report was disabled or what should be improved."
              />
            </div>

            <div className="card" style={{ background: "rgba(0,0,0,0.12)", border: "1px solid rgba(255,255,255,0.10)" }}>
              <div className="cardTitleRow">
                <div>
                  <div className="cardTitle" style={{ fontSize: 15 }}>Report segments</div>
                  <div className="mutedSmall">Each segment pulls latest rows from one DynamoDB table when you run the updater.</div>
                </div>
                <button className="linkBtn" type="button" onClick={addDraftSegment}>Add segment</button>
              </div>

              <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                {(draft.segments || []).map((segment, index) => (
                  <div key={segment.id || index} className="card" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.10)" }}>
                    <div className="cardTitleRow">
                      <div className="mutedSmall">Segment {index + 1}</div>
                      <button className="chipDanger" type="button" onClick={() => removeDraftSegment(index)} disabled={(draft.segments || []).length <= 1}>
                        Remove
                      </button>
                    </div>

                    <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                      <div>
                        <label className="label">Segment heading</label>
                        <input
                          className="input"
                          value={segment.heading || ""}
                          onChange={(e) => updateDraftSegment(index, "heading", e.target.value)}
                          placeholder="e.g., Importer Companies"
                        />
                      </div>

                      <div>
                        <label className="label">DynamoDB table name</label>
                        <input
                          className="input mono"
                          value={segment.source_table || ""}
                          onChange={(e) => updateDraftSegment(index, "source_table", e.target.value)}
                          placeholder="rbrmain-import_export_companies"
                        />
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 0.75fr 1fr", gap: 10 }}>
                        <div>
                          <label className="label">Filter attribute</label>
                          <input
                            className="input"
                            value={segment.filter_attribute || ""}
                            onChange={(e) => updateDraftSegment(index, "filter_attribute", e.target.value)}
                            placeholder="product"
                          />
                        </div>
                        <div>
                          <label className="label">Filter type</label>
                          <select
                            className="input"
                            value={segment.filter_operator || "contains"}
                            onChange={(e) => updateDraftSegment(index, "filter_operator", e.target.value)}
                          >
                            <option value="contains">contains</option>
                            <option value="equals">equals</option>
                            <option value="starts_with">starts with</option>
                          </select>
                        </div>
                        <div>
                          <label className="label">Filter value</label>
                          <input
                            className="input"
                            value={segment.filter_value || ""}
                            onChange={(e) => updateDraftSegment(index, "filter_value", e.target.value)}
                            placeholder="readymade garments"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="label">Columns to print</label>
                        <textarea
                          className="textarea"
                          rows={2}
                          value={segment.columnsText || ""}
                          onChange={(e) => updateDraftSegment(index, "columnsText", e.target.value)}
                          placeholder="company_name, country, product, email, phone"
                        />
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 10, alignItems: "start" }}>
                        <div>
                          <label className="label">Row limit</label>
                          <input
                            className="input"
                            type="number"
                            min="1"
                            max="200"
                            value={segment.row_limit || 25}
                            onChange={(e) => updateDraftSegment(index, "row_limit", e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="label">Section note</label>
                          <input
                            className="input"
                            value={segment.description || ""}
                            onChange={(e) => updateDraftSegment(index, "description", e.target.value)}
                            placeholder="Optional explanatory line printed below the section heading."
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="btn" type="button" onClick={saveDraft} disabled={saving || running}>
                {saving ? "Saving…" : "Save report definition"}
              </button>
              <button className="btnSecondary" type="button" onClick={resetDraft} disabled={saving || running}>Clear form</button>
            </div>
          </div>
        </section>

        <section className="card glass" style={{ border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.045)" }}>
          <div className="cardTitleRow">
            <div>
              <div className="cardTitle">Reports kept up to date</div>
              <div className="mutedSmall">Enable, disable, regenerate, edit names, or remove reports from the maintenance list.</div>
            </div>
            <input
              className="input inputSm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reports / tables / keywords…"
              style={{ maxWidth: 320 }}
            />
          </div>

          {loading ? (
            <div className="empty fancyEmpty"><div className="emptyIcon">⏳</div><div className="emptyTitle">Loading bulk reports…</div></div>
          ) : !reports.length ? (
            <div className="empty fancyEmpty">
              <div className="emptyIcon">📚</div>
              <div className="emptyTitle">No bulk reports yet</div>
              <div className="mutedSmall">Create your first report definition on the left, then run the updater.</div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              {reports.map((report, index) => {
                const isOpen = expandedReports[report.report_id] !== undefined ? expandedReports[report.report_id] : index === 0;
                return (
                  <div key={report.report_id} className="card" style={{ border: report.enabled ? "1px solid rgba(99,102,241,0.24)" : "1px solid rgba(248,113,113,0.22)", background: report.enabled ? "rgba(99,102,241,0.055)" : "rgba(127,29,29,0.08)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                      <button className="linkBtn" type="button" onClick={() => toggleExpanded(report.report_id)} style={{ textAlign: "left", paddingLeft: 0 }}>
                        <span style={{ fontSize: 16, fontWeight: 800 }}>{isOpen ? "▾" : "▸"} {report.report_name}</span>
                        <div className="mutedSmall" style={{ marginTop: 4 }}>
                          <span className="mono">{report.slug}</span> • {report.segments.length} segment(s) • Last updated: {formatBulkDate(report.last_updated_date)}
                        </div>
                      </button>

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <span className={clsx("badge", report.enabled ? "st-done" : "st-failed")}>{report.enabled ? "enabled" : "disabled"}</span>
                        <button className="chip" type="button" onClick={() => editReport(report)}>Edit</button>
                        <button className="chip" type="button" onClick={() => runReport(report)} disabled={running || saving || !report.enabled}>{running ? "Running…" : "Run"}</button>
                        <button className="chip" type="button" onClick={() => toggleReport(report)} disabled={saving || running}>{report.enabled ? "Disable" : "Enable"}</button>
                        <button className="chipDanger" type="button" onClick={() => deleteReport(report)} disabled={saving || running}>Delete</button>
                      </div>
                    </div>

                    {isOpen ? (
                      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                        <div className="mutedSmall">
                          Full key: <span className="mono">{report.full_key || `${report.slug}.pdf`}</span> • Preview key: <span className="mono">{report.preview_key || `${report.slug}_preview.pdf`}</span>
                        </div>
                        {report.keywords?.length ? (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {report.keywords.map((keyword) => <span key={keyword} className="chipDisabled">{keyword}</span>)}
                          </div>
                        ) : null}
                        <div className="tableWrap">
                          <table className="table">
                            <thead>
                              <tr>
                                <th>Segment</th>
                                <th>DynamoDB table</th>
                                <th>Filter</th>
                                <th>Columns</th>
                                <th style={{ width: 90 }}>Rows</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(report.segments || []).map((segment) => (
                                <tr key={segment.id || segment.heading}>
                                  <td>{segment.heading}</td>
                                  <td className="mono">{segment.source_table || "-"}</td>
                                  <td className="mono">
                                    {segment.filter_attribute ? `${segment.filter_attribute} ${segment.filter_operator || "contains"} ${segment.filter_value || ""}` : "No filter"}
                                  </td>
                                  <td>{(segment.columns || []).join(", ") || "All columns"}</td>
                                  <td className="mono">{segment.row_limit || 25}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button className="miniBtn" type="button" onClick={() => copyToClipboard(report.slug)}>Copy slug</button>
                          <button className="miniBtn" type="button" onClick={() => copyToClipboard(JSON.stringify(report.raw || report, null, 2))}>Copy JSON</button>
                          {report.remarks ? <span className="mutedSmall">Note: {report.remarks}</span> : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}


function InstantImportExportAdminPanel({
  mode,
  searchMapSaveApi,
  companySaveApi,
  analyticsApi,
  mappingSeed,
  clearMappingSeed,
  openMappingWithSeed,
  setToast,
  copyToClipboard,
}) {
  const [mapping, setMapping] = useState({
    searchTerm: "",
    mappedTerm: "",
    confidence: 100,
    priority: 1,
    active: true,
    addedBy: "rajan",
    remarks: "",
  });

  const [company, setCompany] = useState({
    country: "",
    productCategory: "",
    companyId: "",
    companyName: "",
    companyBriefing: "",
    brands: "",
    supplyRequested: "",
    searchTerms: "",
    phone: "",
    email: "",
    type: "",
  });

  const [analyticsRows, setAnalyticsRows] = useState(() => {
    try {
      const raw = localStorage.getItem("rbr_import_search_analytics_samples_v1");
      if (raw) return JSON.parse(raw);
    } catch {}
    return [
      { query: "rubber clothes", count: 7, country: "Malaysia", mappingExists: false, lastSeen: nowIso() },
      { query: "clothes", count: 18, country: "Malaysia", mappingExists: true, lastSeen: nowIso() },
      { query: "bamboo garments", count: 3, country: "UAE", mappingExists: false, lastSeen: nowIso() },
    ];
  });
  const [analyticsQuery, setAnalyticsQuery] = useState("");
  const [analyticsCountry, setAnalyticsCountry] = useState("");
  const [saving, setSaving] = useState(false);
  const [panelMsg, setPanelMsg] = useState("");

  useEffect(() => {
    try {
      localStorage.setItem("rbr_import_search_analytics_samples_v1", JSON.stringify(analyticsRows));
    } catch {}
  }, [analyticsRows]);

  useEffect(() => {
    if (!mappingSeed) return;
    setMapping((prev) => ({
      ...prev,
      searchTerm: mappingSeed.searchTerm || mappingSeed.search_key || prev.searchTerm,
      mappedTerm: mappingSeed.mappedTerm || mappingSeed.mapped_term || prev.mappedTerm,
      remarks: mappingSeed.remarks || prev.remarks,
    }));
    clearMappingSeed?.();
  }, [mappingSeed, clearMappingSeed]);

  async function postJsonOrCopy(apiUrl, payload, successText) {
    if (!apiUrl) {
      await copyToClipboard?.(JSON.stringify(payload, null, 2));
      setPanelMsg("API URL is not configured yet. Payload copied to clipboard so you can test it in Lambda/API Gateway.");
      setToast?.("Payload copied ✅");
      return;
    }

    const { res, data } = await fetchJson(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok || data?.ok === false) {
      throw new Error(buildErrorMessage(res, data, "Save failed"));
    }

    setPanelMsg(successText);
    setToast?.("Saved ✅");
  }

  async function saveMapping(e) {
    e.preventDefault();
    setPanelMsg("");

    const payload = {
      search_key: normalizeSlug(mapping.searchTerm),
      mapped_term: normalizeSlug(mapping.mappedTerm),
      confidence: Number(mapping.confidence || 0),
      priority: Number(mapping.priority || 1),
      active: Boolean(mapping.active),
      added_by: mapping.addedBy || "rajan",
      remarks: mapping.remarks || "",
      created_on: new Date().toISOString().slice(0, 10),
      last_updated: new Date().toISOString().slice(0, 10),
    };

    if (!payload.search_key || !payload.mapped_term) {
      setPanelMsg("Search term and mapped product term are required.");
      return;
    }

    setSaving(true);
    try {
      await postJsonOrCopy(searchMapSaveApi, payload, "Search mapping saved successfully.");
      setMapping({ searchTerm: "", mappedTerm: "", confidence: 100, priority: 1, active: true, addedBy: "rajan", remarks: "" });
    } catch (e2) {
      setPanelMsg(e2?.message || "Mapping save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveCompany(e) {
    e.preventDefault();
    setPanelMsg("");

    const countrySlug = normalizeSlug(company.country);
    const categorySlug = normalizeSlug(company.productCategory);
    const idSlug = normalizeSlug(company.companyId || `auto_${Date.now()}`);

    const payload = {
      product_country_key: countrySlug,
      company_id: `${categorySlug}#${idSlug}`,
      product_category: categorySlug,
      company_name: company.companyName,
      company_briefing: company.companyBriefing,
      brands: company.brands,
      supply_requested: company.supplyRequested,
      search_terms: company.searchTerms,
      phone: company.phone,
      email: company.email,
      type: company.type,
      country: company.country,
      created_on: new Date().toISOString().slice(0, 10),
      last_updated: new Date().toISOString().slice(0, 10),
    };

    if (!payload.product_country_key || !categorySlug || !payload.company_name) {
      setPanelMsg("Country, product category, and company name are required.");
      return;
    }

    setSaving(true);
    try {
      await postJsonOrCopy(companySaveApi, payload, "Company line item saved successfully.");
      setCompany({ country: "", productCategory: "", companyId: "", companyName: "", companyBriefing: "", brands: "", supplyRequested: "", searchTerms: "", phone: "", email: "", type: "" });
    } catch (e2) {
      setPanelMsg(e2?.message || "Company save failed");
    } finally {
      setSaving(false);
    }
  }

  async function loadAnalyticsFromApi() {
    if (!analyticsApi) {
      setPanelMsg("Search analytics API is not configured yet. Showing local sample rows for now.");
      return;
    }
    setSaving(true);
    setPanelMsg("");
    try {
      const { res, data } = await fetchJson(analyticsApi, { method: "GET" });
      if (!res.ok || data?.ok === false) throw new Error(buildErrorMessage(res, data, "Analytics load failed"));
      const rows = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      setAnalyticsRows(rows.map((r, idx) => ({
        query: r.query || r.search_query || r.searchTerm || `query_${idx + 1}`,
        count: Number(r.count || r.frequency || 1),
        country: r.country || r.target_country || "",
        mappingExists: Boolean(r.mappingExists || r.mapping_exists),
        lastSeen: r.lastSeen || r.last_seen || r.updatedAt || nowIso(),
      })));
      setPanelMsg("Search analytics loaded.");
    } catch (e2) {
      setPanelMsg(e2?.message || "Analytics load failed");
    } finally {
      setSaving(false);
    }
  }

  function addAnalyticsSample(e) {
    e.preventDefault();
    const q = analyticsQuery.trim();
    if (!q) return;
    setAnalyticsRows((prev) => [
      { query: q, count: 1, country: analyticsCountry.trim(), mappingExists: false, lastSeen: nowIso() },
      ...prev,
    ]);
    setAnalyticsQuery("");
    setAnalyticsCountry("");
    setPanelMsg("Search row added locally.");
  }

  const cardStyle = {
    border: "1px solid rgba(37,99,235,0.28)",
    background: "rgba(10,12,18,0.58)",
  };

  if (mode === "mapping") {
    return (
      <div className="card glass" style={cardStyle}>
        <div className="cardTitleRow">
          <div>
            <div className="cardTitle">Search Term Mapping</div>
            <div className="mutedSmall">Maps real user language to curated product categories.</div>
          </div>
          <div className="mutedSmall mono">rbrmain-import_export_search_terms_map</div>
        </div>

        {panelMsg ? <div className="errorBox" style={{ marginTop: 12 }}>{panelMsg}</div> : null}

        <form onSubmit={saveMapping} style={{ display: "grid", gap: 12, marginTop: 16 }}>
          <div className="historyTools">
            <div style={{ flex: 1 }}>
              <label className="label">User Search Term</label>
              <input className="input" value={mapping.searchTerm} onChange={(e) => setMapping({ ...mapping, searchTerm: e.target.value })} placeholder="Rubber Clothes" />
              <div className="mutedSmall">Saved search_key: <span className="mono">{normalizeSlug(mapping.searchTerm) || "-"}</span></div>
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">Mapped Product Term</label>
              <input className="input" value={mapping.mappedTerm} onChange={(e) => setMapping({ ...mapping, mappedTerm: e.target.value })} placeholder="Rubber Gloves" />
              <div className="mutedSmall">Saved mapped_term: <span className="mono">{normalizeSlug(mapping.mappedTerm) || "-"}</span></div>
            </div>
          </div>

          <div className="historyTools">
            <div style={{ width: 160 }}>
              <label className="label">Priority</label>
              <input className="input" type="number" min="1" value={mapping.priority} onChange={(e) => setMapping({ ...mapping, priority: e.target.value })} />
            </div>
            <div style={{ width: 160 }}>
              <label className="label">Confidence</label>
              <input className="input" type="number" min="0" max="100" value={mapping.confidence} onChange={(e) => setMapping({ ...mapping, confidence: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">Added By</label>
              <input className="input" value={mapping.addedBy} onChange={(e) => setMapping({ ...mapping, addedBy: e.target.value })} />
            </div>
          </div>

          <label className="label">Remarks</label>
          <textarea className="textarea" rows={3} value={mapping.remarks} onChange={(e) => setMapping({ ...mapping, remarks: e.target.value })} placeholder="Why this mapping is relevant" />

          <label className="label" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input type="checkbox" checked={mapping.active} onChange={(e) => setMapping({ ...mapping, active: e.target.checked })} />
            Active mapping
          </label>

          <div className="actions">
            <button className="btn" type="submit" disabled={saving}>{saving ? "Saving..." : searchMapSaveApi ? "Save Mapping" : "Copy Payload"}</button>
          </div>
        </form>
      </div>
    );
  }

  if (mode === "companies") {
    return (
      <div className="card glass" style={cardStyle}>
        <div className="cardTitleRow">
          <div>
            <div className="cardTitle">Importer Database Line Item</div>
            <div className="mutedSmall">Adds verified companies used in Exports & Import Possibilities.</div>
          </div>
          <div className="mutedSmall mono">rbrmain-import_export_companies</div>
        </div>

        {panelMsg ? <div className="errorBox" style={{ marginTop: 12 }}>{panelMsg}</div> : null}

        <form onSubmit={saveCompany} style={{ display: "grid", gap: 12, marginTop: 16 }}>
          <div className="historyTools">
            <div style={{ flex: 1 }}>
              <label className="label">Country</label>
              <input className="input" value={company.country} onChange={(e) => setCompany({ ...company, country: e.target.value })} placeholder="Malaysia" />
              <div className="mutedSmall">PK: <span className="mono">{normalizeSlug(company.country) || "-"}</span></div>
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">Product Category</label>
              <input className="input" value={company.productCategory} onChange={(e) => setCompany({ ...company, productCategory: e.target.value })} placeholder="Rubber Gloves" />
              <div className="mutedSmall">SK prefix: <span className="mono">{normalizeSlug(company.productCategory) || "-"}#</span></div>
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">Company ID</label>
              <input className="input" value={company.companyId} onChange={(e) => setCompany({ ...company, companyId: e.target.value })} placeholder="MY000001" />
            </div>
          </div>

          <label className="label">Company Name</label>
          <input className="input" value={company.companyName} onChange={(e) => setCompany({ ...company, companyName: e.target.value })} placeholder="Padini Holdings Berhad" />

          <label className="label">Company Briefing</label>
          <textarea className="textarea" rows={3} value={company.companyBriefing} onChange={(e) => setCompany({ ...company, companyBriefing: e.target.value })} />

          <div className="historyTools">
            <div style={{ flex: 1 }}>
              <label className="label">Brands</label>
              <textarea className="textarea" rows={3} value={company.brands} onChange={(e) => setCompany({ ...company, brands: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">Supply Requested</label>
              <textarea className="textarea" rows={3} value={company.supplyRequested} onChange={(e) => setCompany({ ...company, supplyRequested: e.target.value })} />
            </div>
          </div>

          <label className="label">Search Terms</label>
          <textarea className="textarea" rows={3} value={company.searchTerms} onChange={(e) => setCompany({ ...company, searchTerms: e.target.value })} placeholder="rubber gloves, latex gloves, industrial safety gloves" />

          <div className="historyTools">
            <div style={{ flex: 1 }}>
              <label className="label">Phone</label>
              <input className="input" value={company.phone} onChange={(e) => setCompany({ ...company, phone: e.target.value })} placeholder="+603..." />
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">Email</label>
              <input className="input" value={company.email} onChange={(e) => setCompany({ ...company, email: e.target.value })} placeholder="purchasing@example.com" />
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">Type</label>
              <input className="input" value={company.type} onChange={(e) => setCompany({ ...company, type: e.target.value })} placeholder="Importer / Retail Chain / Distributor" />
            </div>
          </div>

          <div className="actions">
            <button className="btn" type="submit" disabled={saving}>{saving ? "Saving..." : companySaveApi ? "Save Company" : "Copy Payload"}</button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="card glass" style={cardStyle}>
      <div className="cardTitleRow">
        <div>
          <div className="cardTitle">Search Analytics</div>
          <div className="mutedSmall">Review real searches, find unmapped phrases, then create mappings.</div>
        </div>
        <button className="btnSecondary" type="button" onClick={loadAnalyticsFromApi} disabled={saving}>
          {saving ? "Loading..." : "Refresh Analytics"}
        </button>
      </div>

      {panelMsg ? <div className="errorBox" style={{ marginTop: 12 }}>{panelMsg}</div> : null}

      <form className="historyTools" style={{ marginTop: 16 }} onSubmit={addAnalyticsSample}>
        <input className="input inputSm" value={analyticsQuery} onChange={(e) => setAnalyticsQuery(e.target.value)} placeholder="Add sample user search, e.g. rubber clothes" />
        <input className="input inputSm" value={analyticsCountry} onChange={(e) => setAnalyticsCountry(e.target.value)} placeholder="Country, e.g. Malaysia" />
        <button className="btnSecondary" type="submit">Add Local Row</button>
      </form>

      <div className="tableWrap" style={{ marginTop: 14 }}>
        <table className="table">
          <thead>
            <tr>
              <th>User Search</th>
              <th style={{ width: 120 }}>Normalized</th>
              <th style={{ width: 100 }}>Count</th>
              <th style={{ width: 130 }}>Country</th>
              <th style={{ width: 135 }}>Mapping</th>
              <th style={{ width: 220 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {analyticsRows.map((row, idx) => {
              const normalized = normalizeSlug(row.query);
              return (
                <tr key={`${row.query}-${idx}`} className="row">
                  <td>
                    <div className="titleCell">{row.query}</div>
                    <div className="mutedSmall">Last seen: {String(row.lastSeen || "").slice(0, 10)}</div>
                  </td>
                  <td className="mono">{normalized}</td>
                  <td>{row.count || 1}</td>
                  <td>{row.country || "-"}</td>
                  <td>{row.mappingExists ? "✅ Exists" : "⚠️ Missing"}</td>
                  <td>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button className="btnSecondary" type="button" onClick={() => openMappingWithSeed?.({ searchTerm: row.query, remarks: `Created from Search Analytics. Country: ${row.country || "-"}` })}>
                        Create Mapping
                      </button>
                      <button className="linkBtn" type="button" onClick={() => copyToClipboard?.(normalized)}>
                        Copy key
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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



function AdsIntelligencePanel({
  adsItems,
  websiteSearchItems,
  matchedWebsiteSearchItems,
  unmatchedWebsiteSearchItems,
  websiteSearchSummary,
  adsTableOpen,
  setAdsTableOpen,
  websiteTableOpen,
  setWebsiteTableOpen,
  adsSummary,
  adsLoading,
  adsUpdating,
  adsError,
  adsSearch,
  setAdsSearch,
  adsQualityFilter,
  setAdsQualityFilter,
  adsDeviceFilter,
  setAdsDeviceFilter,
  adsQualityOptions,
  adsDeviceOptions,
  adsMeta,
  loadAdsIntelligence,
  updateGoogleAdsDetails,
  expandedAdsRows,
  toggleAdsRow,
  copyToClipboard,
}) {
  const lastPulledLabel = (() => {
    if (!adsMeta?.lastPulledAt) return "Not available";
    const d = new Date(adsMeta.lastPulledAt);
    if (Number.isNaN(d.getTime())) return adsMeta.lastPulledAt;
    return d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  })();

  const [adsSort, setAdsSort] = useState({ key: "date", direction: "desc" });

  const adsColumns = useMemo(
    () => [
      { key: "date", label: "Date", width: 108, type: "date" },
      { key: "keyword", label: "Keyword", width: 160, type: "text" },
      { key: "searchTerm", label: "Google search term", type: "text" },
      { key: "website", label: "Website search/context", type: "text" },
      { key: "device", label: "Device", width: 95, type: "text" },
      { key: "clicks", label: "Clicks", width: 80, type: "number" },
      { key: "cost", label: "Cost", width: 95, type: "number" },
      { key: "leads", label: "Leads", width: 90, type: "number" },
      { key: "sales", label: "Sales", width: 95, type: "number" },
      { key: "quality", label: "Quality", width: 125, type: "text" },
    ],
    []
  );

  function getAdsWebsiteLabel(item = {}) {
    return item.websiteSearchTerms?.length
      ? item.websiteSearchTerms.slice(0, 2).join(" • ")
      : item.websiteContext || item.matchedReportSlug || "-";
  }

  function getAdsSortValue(item = {}, key) {
    if (key === "date") {
      const d = item.date ? new Date(item.date) : null;
      return d && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
    }
    if (key === "website") return getAdsWebsiteLabel(item);
    if (key === "sales") return Number(item.sales || 0) * 1000000000 + toAmountNumber(item.revenue);
    if (["clicks", "cost", "leads"].includes(key)) return toAmountNumber(item[key]);
    return item[key] ?? "";
  }

  const sortedAdsItems = useMemo(() => {
    const column = adsColumns.find((c) => c.key === adsSort.key) || adsColumns[0];
    const direction = adsSort.direction === "asc" ? 1 : -1;

    return [...(adsItems || [])].sort((a, b) => {
      const av = getAdsSortValue(a, column.key);
      const bv = getAdsSortValue(b, column.key);

      if (column.type === "number" || column.type === "date") {
        const an = Number(av) || 0;
        const bn = Number(bv) || 0;
        if (an !== bn) return (an - bn) * direction;
      } else {
        const cmp = String(av || "").localeCompare(String(bv || ""), undefined, {
          numeric: true,
          sensitivity: "base",
        });
        if (cmp !== 0) return cmp * direction;
      }

      return String(a.id || "").localeCompare(String(b.id || ""));
    });
  }, [adsItems, adsSort, adsColumns]);

  function toggleAdsSort(key) {
    setAdsSort((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  }

  function SortableAdsHeader({ column }) {
    const active = adsSort.key === column.key;
    const indicator = active ? (adsSort.direction === "asc" ? "▲" : "▼") : "↕";

    return (
      <th style={{ width: column.width, textAlign: "center" }}>
        <button
          type="button"
          onClick={() => toggleAdsSort(column.key)}
          title={`Sort by ${column.label}`}
          style={{
            width: "100%",
            border: 0,
            background: "transparent",
            color: "inherit",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            font: "inherit",
            fontWeight: 700,
            textAlign: "center",
            padding: 0,
          }}
        >
          <span>{column.label}</span>
          <span className="mutedSmall" aria-hidden="true">{indicator}</span>
        </button>
      </th>
    );
  }

  const sortedWebsiteSearchItems = useMemo(() => {
    return [...(websiteSearchItems || [])].sort((a, b) => {
      const ad = `${a.date || ""} ${a.timestamp || ""}`;
      const bd = `${b.date || ""} ${b.timestamp || ""}`;
      return bd.localeCompare(ad, undefined, { numeric: true });
    });
  }, [websiteSearchItems]);

  function getWebsiteTimeLabel(item = {}) {
    if (!item.timestamp) return "-";
    const timeMatch = String(item.timestamp).match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
    if (timeMatch) return timeMatch[1];
    const d = new Date(item.timestamp);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    }
    return item.timestamp;
  }

  function getWebsiteDateLabel(item = {}) {
    const raw = item.date || item.dateKey || item.timestamp || "";
    if (!raw) return "-";
    const d = new Date(String(raw).length === 10 ? `${raw}T00:00:00` : raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  }

  function CollapsibleTableHeader({ title, subtitle, count, open, onToggle, accent = "rgba(14,165,233,0.20)" }) {
    return (
      <div
        className="card"
        style={{
          marginTop: 14,
          background: "rgba(255,255,255,0.035)",
          border: `1px solid ${accent}`,
        }}
      >
        <div className="cardTitleRow">
          <div>
            <div className="cardTitle">{title}</div>
            <div className="mutedSmall">{subtitle}</div>
          </div>
          <div className="rowActions">
            <span className="chipDisabled">{formatNumberCompact(count)} rows</span>
            <button className="btnSecondary" type="button" onClick={onToggle}>
              {open ? "Minimize table" : "Expand table"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card glass" style={{ border: "1px solid rgba(14,165,233,0.28)", background: "rgba(6,18,28,0.46)" }}>
      <div className="cardTitleRow">
        <div>
          <div className="cardTitle">Traffic Intelligence</div>
          <div className="mutedSmall">
            Traffic source → campaign/post/keyword → website search/context → lead/sale outcome.
          </div>
        </div>
        <div className="rowActions">
          <button className="btnSecondary" onClick={loadAdsIntelligence} type="button" disabled={adsLoading || adsUpdating}>
            {adsLoading ? "Refreshing…" : "Refresh view"}
          </button>
          <button className="btnPrimary" onClick={updateGoogleAdsDetails} type="button" disabled={adsUpdating || adsLoading}>
            {adsUpdating ? "Updating Google Ads…" : "Update Google Ads details"}
          </button>
        </div>
      </div>

      <div className="mutedSmall" style={{ marginTop: 8 }}>
        This page shows data saved from the last pull. Click the update button only when you want today’s Google Ads details until now.
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(8, minmax(130px, 1fr))",
          gap: 12,
          marginTop: 14,
        }}
      >
        {[
          ["Google Ads rows", adsItems.length],
          ["Clicks", formatNumberCompact(adsSummary.clicks)],
          ["Cost", formatInr(adsSummary.cost)],
          ["Matched website context", formatNumberCompact(adsSummary.websiteSearches)],
          ["Website searches found", formatNumberCompact(websiteSearchSummary.total)],
          ["Unmatched website searches", formatNumberCompact(websiteSearchSummary.unmatched)],
          ["Leads", formatNumberCompact(adsSummary.leads)],
          ["Sales / Revenue", `${formatNumberCompact(adsSummary.sales)} • ${formatInr(adsSummary.revenue)}`],
        ].map(([label, value]) => (
          <div key={label} className="card" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}>
            <div className="mutedSmall">{label}</div>
            <div className="mono" style={{ fontSize: 18, marginTop: 6 }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 12, background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.10)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div className="mutedSmall">Last Google Ads pull</div>
            <div className="mono" style={{ marginTop: 4 }}>{lastPulledLabel}</div>
          </div>
          <div>
            <div className="mutedSmall">API source</div>
            <div className="mono" style={{ marginTop: 4 }}>{adsMeta?.source || "-"}</div>
          </div>
        </div>
      </div>

      <div className="historyTools" style={{ marginTop: 14, gridTemplateColumns: "minmax(220px, 1.5fr) minmax(150px, 0.6fr) minmax(150px, 0.6fr) auto" }}>
        <input
          className="input inputSm"
          value={adsSearch}
          onChange={(e) => setAdsSearch(e.target.value)}
          placeholder="Search keyword / Google term / website search / city / IP / campaign…"
        />
        <select className="input inputSm" value={adsQualityFilter} onChange={(e) => setAdsQualityFilter(e.target.value)}>
          {adsQualityOptions.map((q) => (
            <option key={q} value={q}>{q === "all" ? "All quality" : q}</option>
          ))}
        </select>
        <select className="input inputSm" value={adsDeviceFilter} onChange={(e) => setAdsDeviceFilter(e.target.value)}>
          {adsDeviceOptions.map((d) => (
            <option key={d} value={d}>{d === "all" ? "All devices" : d}</option>
          ))}
        </select>
        <button className="btnSecondary" onClick={() => setAdsSearch("")} type="button">
          Clear
        </button>
      </div>

      {adsError ? <div className="errorBox">Error: {adsError}</div> : null}

      {adsLoading && !adsItems.length ? (
        <div className="empty fancyEmpty" style={{ marginTop: 12 }}>
          <div className="emptyIcon">📡</div>
          <div className="emptyTitle">Loading Traffic Intelligence…</div>
          <div className="mutedSmall">Fetching the last saved traffic + website context view.</div>
        </div>
      ) : null}

      {!adsLoading && !adsItems.length ? (
        <div className="empty fancyEmpty" style={{ marginTop: 12 }}>
          <div className="emptyIcon">🛰️</div>
          <div className="emptyTitle">No Traffic Intelligence rows found</div>
          <div className="mutedSmall">
            Add VITE_TRAFFIC_INTELLIGENCE_API, or click “Update Google Ads details” after adding VITE_GOOGLE_ADS_UPDATE_API.
          </div>
        </div>
      ) : null}

      <CollapsibleTableHeader
        title="Google Ads Traffic Rows"
        subtitle="Google Ads search terms enriched with matched website searches when available."
        count={adsItems.length}
        open={adsTableOpen}
        onToggle={() => setAdsTableOpen(!adsTableOpen)}
      />

      {adsItems.length && adsTableOpen ? (
        <div className="tableWrap" style={{ marginTop: 10 }}>
          <table className="table">
            <thead>
              <tr>
                {adsColumns.map((column) => (
                  <SortableAdsHeader key={column.key} column={column} />
                ))}
                <th style={{ width: 78, textAlign: "center" }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {sortedAdsItems.map((item) => {
                const rowOpen = Boolean(expandedAdsRows[item.id]);
                const dt = item.date ? new Date(item.date) : null;
                const dateLabel = dt && !Number.isNaN(dt.getTime()) ? dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : item.dateKey || "-";
                const websiteLabel = getAdsWebsiteLabel(item);

                return (
                  <React.Fragment key={item.id}>
                    <tr className="row">
                      <td className="mono">{dateLabel}</td>
                      <td>
                        <div className="titleCell">{item.keyword}</div>
                        <div className="mutedSmall">{item.matchType || item.campaign}</div>
                      </td>
                      <td>
                        <div>{item.searchTerm}</div>
                        <div className="mutedSmall">{item.adGroup}</div>
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <div>{websiteLabel}</div>
                        {item.matchedReportSlug ? <div className="mutedSmall">Matched: {item.matchedReportSlug}</div> : null}
                      </td>
                      <td style={{ textAlign: "center" }}>{item.device}</td>
                      <td className="mono" style={{ textAlign: "center" }}>{formatNumberCompact(item.clicks)}</td>
                      <td className="mono" style={{ textAlign: "center" }}>{formatInr(item.cost)}</td>
                      <td className="mono" style={{ textAlign: "center" }}>{formatNumberCompact(item.leads)}</td>
                      <td className="mono" style={{ textAlign: "center" }}>{formatNumberCompact(item.sales)} / {formatInr(item.revenue)}</td>
                      <td style={{ textAlign: "center" }}>
                        <span className={clsx("badge", getAdsQualityClass(item.quality))}>{item.quality}</span>
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <button className="miniBtn" onClick={() => toggleAdsRow(item.id)} type="button">
                          {rowOpen ? "Hide" : "View"}
                        </button>
                      </td>
                    </tr>
                    {rowOpen ? (
                      <tr className="row">
                        <td colSpan={11}>
                          <div className="card" style={{ background: "rgba(14,165,233,0.06)", border: "1px solid rgba(14,165,233,0.18)" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(180px, 1fr))", gap: 12 }}>
                              <div>
                                <div className="mutedSmall">Campaign / Ad group</div>
                                <div>{item.campaign}</div>
                                <div className="mutedSmall">{item.adGroup}</div>
                              </div>
                              <div>
                                <div className="mutedSmall">All website search terms</div>
                                <div>{item.websiteSearchTerms?.length ? item.websiteSearchTerms.join(" • ") : item.websiteContext || "-"}</div>
                              </div>
                              <div>
                                <div className="mutedSmall">Suggested action</div>
                                <div>{item.actionSuggestion || "Review keyword/search term quality and decide exact keyword, negative keyword, or content idea."}</div>
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                              <button className="miniBtn" onClick={() => copyToClipboard(item.searchTerm)} type="button">Copy search term</button>
                              <button className="miniBtn" onClick={() => copyToClipboard(item.keyword)} type="button">Copy keyword</button>
                              <button className="miniBtn" onClick={() => copyToClipboard(JSON.stringify(item.raw, null, 2))} type="button">Copy raw row</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <CollapsibleTableHeader
        title="Website Searches Found"
        subtitle="First-party searches from S3 logs. These are shown even when not matched to Google Ads."
        count={websiteSearchItems.length}
        open={websiteTableOpen}
        onToggle={() => setWebsiteTableOpen(!websiteTableOpen)}
        accent="rgba(34,197,94,0.25)"
      />

      {websiteSearchItems.length && websiteTableOpen ? (
        <div className="tableWrap" style={{ marginTop: 10 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 96, textAlign: "center" }}>Date</th>
                <th style={{ width: 110, textAlign: "center" }}>Time</th>
                <th>Website search</th>
                <th style={{ width: 135, textAlign: "center" }}>City</th>
                <th style={{ width: 135, textAlign: "center" }}>State</th>
                <th style={{ width: 135, textAlign: "center" }}>IP</th>
                <th style={{ width: 140, textAlign: "center" }}>Match status</th>
                <th>Matched Google search</th>
                <th style={{ width: 86, textAlign: "center" }}>Copy</th>
              </tr>
            </thead>
            <tbody>
              {sortedWebsiteSearchItems.map((item) => {
                const matchedTerms = item.matchedGoogleSearchTerms || [];
                return (
                  <tr className="row" key={item.id}>
                    <td className="mono" style={{ textAlign: "center" }}>{getWebsiteDateLabel(item)}</td>
                    <td className="mono" style={{ textAlign: "center" }}>{getWebsiteTimeLabel(item)}</td>
                    <td>
                      <div className="titleCell">{item.query || "-"}</div>
                      {(item.phone || item.email || item.pincode) ? (
                        <div className="mutedSmall">
                          {[item.phone, item.email, item.pincode].filter(Boolean).join(" • ")}
                        </div>
                      ) : null}
                    </td>
                    <td style={{ textAlign: "center" }}>{item.city || "-"}</td>
                    <td style={{ textAlign: "center" }}>{item.state || "-"}</td>
                    <td className="mono" style={{ textAlign: "center" }}>{item.ip || "-"}</td>
                    <td style={{ textAlign: "center" }}>
                      <span className={clsx("badge", item.matchedGoogleAds ? "st-warm" : "st-needs-review")}>
                        {item.matchedGoogleAds ? `Matched ${item.bestMatchConfidence || ""}` : "Unmatched"}
                      </span>
                      {item.bestMatchScore ? <div className="mutedSmall">Score {item.bestMatchScore}</div> : null}
                    </td>
                    <td>
                      {matchedTerms.length ? matchedTerms.slice(0, 3).join(" • ") : "-"}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <button className="miniBtn" type="button" onClick={() => copyToClipboard(item.query || "")}>Copy</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {!websiteSearchItems.length && !adsLoading ? (
        <div className="empty fancyEmpty" style={{ marginTop: 12 }}>
          <div className="emptyIcon">🔎</div>
          <div className="emptyTitle">No website searches found in the loaded date range</div>
          <div className="mutedSmall">The API is ready, but the current response did not include website_searches.</div>
        </div>
      ) : null}
    </div>
  );
}


function WebsiteSearchesPanel({
  items,
  groupedItems,
  columns,
  summary,
  loading,
  error,
  search,
  setSearch,
  groupBy,
  setGroupBy,
  groupOptions,
  expandedGroups,
  expandedRows,
  toggleGroup,
  toggleRow,
  maximizeAllGroups,
  minimizeAllGroups,
  meta,
  loadWebsiteSearches,
  copyToClipboard,
}) {
  const [visibleRawColumns, setVisibleRawColumns] = useState([]);

  useEffect(() => {
    setVisibleRawColumns((prev) => {
      if (prev.length) return prev.filter((column) => columns.includes(column)).slice(0, 6);
      return columns
        .filter((column) => {
          const c = normalize(column);
          return ![
            "query",
            "search",
            "search_term",
            "searchterm",
            "term",
            "timestamp",
            "time",
            "date",
            "ip",
            "ip_address",
            "ipaddress",
            "city",
            "state",
            "country",
          ].includes(c);
        })
        .slice(0, 4);
    });
  }, [columns]);

  const lastUpdatedLabel = (() => {
    if (!meta?.lastUpdatedAt) return "Not available";
    const d = new Date(meta.lastUpdatedAt);
    if (Number.isNaN(d.getTime())) return meta.lastUpdatedAt;
    return d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  })();

  function getDateLabel(item = {}) {
    const raw = item.date || item.dateKey || item.timestamp || "";
    if (!raw) return "-";
    const d = new Date(String(raw).length === 10 ? `${raw}T00:00:00` : raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  }

  function getTimeLabel(item = {}) {
    const timestamp = getSearchExplorerTimestamp(item);
    if (!timestamp) return "-";
    const timeMatch = String(timestamp).match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
    if (timeMatch) return timeMatch[1];
    const d = new Date(timestamp);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    }
    return timestamp;
  }

  function rawPreview(item = {}) {
    const entries = Object.entries(item.raw || {}).filter(([key, value]) => value !== undefined && value !== null && value !== "");
    if (!entries.length) return "No raw columns available";
    return entries.slice(0, 8).map(([key, value]) => `${key}: ${value}`).join(" • ");
  }

  function toggleRawColumn(column) {
    setVisibleRawColumns((prev) =>
      prev.includes(column)
        ? prev.filter((x) => x !== column)
        : [...prev, column].slice(-6)
    );
  }

  return (
    <div className="card glass" style={{ border: "1px solid rgba(34,197,94,0.28)", background: "rgba(5,25,16,0.46)" }}>
      <div className="cardTitleRow">
        <div>
          <div className="cardTitle">Website Searches</div>
          <div className="mutedSmall">
            All first-party website searches from the search logging file, with grouping by IP, location, or any captured Excel column.
          </div>
        </div>
        <div className="rowActions">
          <button className="btnSecondary" onClick={loadWebsiteSearches} type="button" disabled={loading}>
            {loading ? "Refreshing…" : "Refresh searches"}
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, minmax(130px, 1fr))",
          gap: 12,
          marginTop: 14,
        }}
      >
        {[
          ["Search rows", formatNumberCompact(summary.total)],
          ["Unique searches", formatNumberCompact(summary.uniqueQueries)],
          ["Unique IPs", formatNumberCompact(summary.uniqueIps)],
          ["Unique locations", formatNumberCompact(summary.uniqueLocations)],
          ["Known phones", formatNumberCompact(summary.knownPhones)],
          ["Known emails", formatNumberCompact(summary.knownEmails)],
        ].map(([label, value]) => (
          <div key={label} className="card" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}>
            <div className="mutedSmall">{label}</div>
            <div className="mono" style={{ fontSize: 18, marginTop: 6 }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 12, background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.10)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(180px, 1fr))", gap: 12 }}>
          <div>
            <div className="mutedSmall">API source</div>
            <div className="mono" style={{ marginTop: 4 }}>{meta?.source || "-"}</div>
          </div>
          <div>
            <div className="mutedSmall">Last refreshed</div>
            <div className="mono" style={{ marginTop: 4 }}>{lastUpdatedLabel}</div>
          </div>
          <div>
            <div className="mutedSmall">Captured Excel columns</div>
            <div className="mono" style={{ marginTop: 4 }}>{formatNumberCompact(columns.length)}</div>
          </div>
        </div>
      </div>

      <div className="historyTools" style={{ marginTop: 14, gridTemplateColumns: "minmax(260px, 1.6fr) minmax(210px, 0.7fr) auto auto auto" }}>
        <input
          className="input inputSm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search term / IP / city / phone / email / any raw Excel value…"
        />
        <select className="input inputSm" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
          {groupOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <button className="btnSecondary" type="button" onClick={maximizeAllGroups} disabled={!groupedItems.length}>
          Maximize all groups
        </button>
        <button className="btnSecondary" type="button" onClick={minimizeAllGroups} disabled={!groupedItems.length}>
          Minimize all groups
        </button>
        <button className="btnSecondary" type="button" onClick={() => setSearch("")} disabled={!search}>
          Clear
        </button>
      </div>

      {columns.length ? (
        <div className="card" style={{ marginTop: 12, background: "rgba(255,255,255,0.028)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="mutedSmall" style={{ marginBottom: 8 }}>Optional raw Excel columns to show in the main table</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {columns.slice(0, 40).map((column) => (
              <button
                key={column}
                type="button"
                className={visibleRawColumns.includes(column) ? "miniBtn" : "linkBtn"}
                onClick={() => toggleRawColumn(column)}
                style={{ border: visibleRawColumns.includes(column) ? "1px solid rgba(34,197,94,0.35)" : undefined }}
              >
                {column}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {error ? <div className="errorBox">Error: {error}</div> : null}

      {loading && !items.length ? (
        <div className="empty fancyEmpty" style={{ marginTop: 12 }}>
          <div className="emptyIcon">🔎</div>
          <div className="emptyTitle">Loading website searches…</div>
          <div className="mutedSmall">Fetching the search logging rows from the website-searches API.</div>
        </div>
      ) : null}

      {!loading && !items.length ? (
        <div className="empty fancyEmpty" style={{ marginTop: 12 }}>
          <div className="emptyIcon">🧾</div>
          <div className="emptyTitle">No website searches found</div>
          <div className="mutedSmall">Add VITE_WEBSITE_SEARCHES_API in Amplify, or point it temporarily to the existing Traffic Intelligence API if that response includes website_searches.</div>
        </div>
      ) : null}

      {items.length ? (
        <div style={{ marginTop: 14 }}>
          {groupedItems.map((group) => {
            const open = expandedGroups[group.key] !== undefined ? expandedGroups[group.key] : true;
            const sampleTerms = Array.from(group.uniqueQueries || []).filter(Boolean).slice(0, 4).join(" • ");
            return (
              <div key={group.key} className="card" style={{ marginTop: 12, background: "rgba(255,255,255,0.035)", border: "1px solid rgba(34,197,94,0.16)" }}>
                <div className="cardTitleRow">
                  <div>
                    <div className="cardTitle" style={{ fontSize: 15 }}>{group.label}</div>
                    <div className="mutedSmall">
                      {formatNumberCompact(group.items.length)} searches • {formatNumberCompact(group.uniqueQueryCount)} unique search terms • {formatNumberCompact(group.uniqueIpCount)} IPs
                      {sampleTerms ? ` • ${sampleTerms}` : ""}
                    </div>
                  </div>
                  <button className="btnSecondary" type="button" onClick={() => toggleGroup(group.key)}>
                    {open ? "Minimize group" : "Expand group"}
                  </button>
                </div>

                {open ? (
                  <div className="tableWrap" style={{ marginTop: 10 }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th style={{ width: 112, textAlign: "center" }}>Date</th>
                          <th style={{ width: 105, textAlign: "center" }}>Time</th>
                          <th>Website search</th>
                          <th style={{ width: 150, textAlign: "center" }}>IP</th>
                          <th style={{ width: 210, textAlign: "center" }}>Location</th>
                          <th style={{ width: 115, textAlign: "center" }}>Device</th>
                          <th style={{ width: 180, textAlign: "center" }}>User info</th>
                          {visibleRawColumns.map((column) => (
                            <th key={column} style={{ minWidth: 140, textAlign: "center" }}>{column}</th>
                          ))}
                          <th style={{ width: 86, textAlign: "center" }}>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map((item) => {
                          const rowOpen = Boolean(expandedRows[item.id]);
                          return (
                            <React.Fragment key={item.id}>
                              <tr className="row">
                                <td className="mono" style={{ textAlign: "center" }}>{getDateLabel(item)}</td>
                                <td className="mono" style={{ textAlign: "center" }}>{getTimeLabel(item)}</td>
                                <td>
                                  <div className="titleCell">{item.query || "-"}</div>
                                  <div className="mutedSmall">{item.source || "website_search_log"}</div>
                                </td>
                                <td className="mono" style={{ textAlign: "center" }}>{item.ip || "-"}</td>
                                <td style={{ textAlign: "center" }}>
                                  <div>{getSearchExplorerLocation(item)}</div>
                                  {item.pincode ? <div className="mutedSmall">PIN: {item.pincode}</div> : null}
                                </td>
                                <td style={{ textAlign: "center" }}>{item.device || "-"}</td>
                                <td style={{ textAlign: "center" }}>
                                  <div>{item.phone || "-"}</div>
                                  {item.email ? <div className="mutedSmall">{item.email}</div> : null}
                                </td>
                                {visibleRawColumns.map((column) => (
                                  <td key={`${item.id}-${column}`} style={{ textAlign: "center" }}>
                                    {String(getRawColumnValue(item.raw, column) || "-").slice(0, 80)}
                                  </td>
                                ))}
                                <td style={{ textAlign: "center" }}>
                                  <button className="miniBtn" type="button" onClick={() => toggleRow(item.id)}>
                                    {rowOpen ? "Hide" : "View"}
                                  </button>
                                </td>
                              </tr>
                              {rowOpen ? (
                                <tr className="row">
                                  <td colSpan={8 + visibleRawColumns.length}>
                                    <div className="card" style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.18)" }}>
                                      <div className="mutedSmall">Raw search logging row</div>
                                      <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(3, minmax(180px, 1fr))", gap: 10 }}>
                                        {Object.entries(item.raw || {}).map(([key, value]) => (
                                          <div key={key}>
                                            <div className="mutedSmall">{key}</div>
                                            <div>{String(value ?? "-")}</div>
                                          </div>
                                        ))}
                                      </div>
                                      <div className="mutedSmall" style={{ marginTop: 10 }}>{rawPreview(item)}</div>
                                      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                                        <button className="miniBtn" type="button" onClick={() => copyToClipboard(item.query || "")}>Copy search</button>
                                        <button className="miniBtn" type="button" onClick={() => copyToClipboard(item.ip || "")}>Copy IP</button>
                                        <button className="miniBtn" type="button" onClick={() => copyToClipboard(JSON.stringify(item.raw, null, 2))}>Copy raw row</button>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              ) : null}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SalesPanel({
  groupedSales,
  salesItems,
  allSalesCount,
  salesTotalAmount,
  salesLoading,
  salesError,
  salesSearch,
  setSalesSearch,
  loadSales,
  expandedSaleMonths,
  expandedSaleDates,
  toggleSaleMonth,
  toggleSaleDate,
  salesMeta,
  rawSalesResponse,
  copyToClipboard,
}) {
  const unknownDateCount = salesItems.filter((sale) => sale.dateKey === "unknown-date").length;
  const reportedTotal = Number(salesMeta?.total || 0);
  const paginationGap = Math.max(0, reportedTotal - Number(allSalesCount || 0));

  return (
    <div className="card glass" style={{ border: "1px solid rgba(245,158,11,0.28)", background: "rgba(20,14,6,0.42)" }}>
      <div className="cardTitleRow">
        <div>
          <div className="cardTitle">Sales Dashboard</div>
          <div className="mutedSmall">Grouped by month/year → date of sale → individual sale details.</div>
        </div>
        <div className="rowActions">
          <button className="linkBtn" onClick={loadSales} type="button">
            {salesLoading ? "Refreshing…" : "Refresh sales"}
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(160px, 1fr))",
          gap: 12,
          marginTop: 14,
        }}
      >
        <div className="card" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}>
          <div className="mutedSmall">Total sales shown</div>
          <div className="mono" style={{ fontSize: 22, marginTop: 4 }}>{salesItems.length}</div>
        </div>
        <div className="card" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}>
          <div className="mutedSmall">Total amount shown</div>
          <div className="mono" style={{ fontSize: 22, marginTop: 4 }}>{formatInr(salesTotalAmount)}</div>
        </div>
        <div className="card" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}>
          <div className="mutedSmall">API source</div>
          <div className="mono" style={{ fontSize: 14, marginTop: 8 }}>{salesMeta?.source || "-"}</div>
          <div className="mutedSmall" style={{ marginTop: 5 }}>
            API reported {reportedTotal || allSalesCount || 0} record{(reportedTotal || allSalesCount || 0) === 1 ? "" : "s"}
          </div>
          {salesMeta?.fetchedAt ? (
            <div className="mutedSmall" style={{ marginTop: 5 }}>
              Refreshed {new Date(salesMeta.fetchedAt).toLocaleString("en-IN")}
            </div>
          ) : null}
        </div>
      </div>

      <div className="historyTools" style={{ marginTop: 14 }}>
        <input
          className="input inputSm"
          value={salesSearch}
          onChange={(e) => setSalesSearch(e.target.value)}
          placeholder="Search mobile / name / report / payment ID…"
        />
        <button className="btnSecondary" onClick={() => setSalesSearch("")} type="button">
          Clear
        </button>
      </div>

      {salesError ? <div className="errorBox">Error: {salesError}</div> : null}

      {paginationGap > 0 ? (
        <div className="errorBox" style={{ marginTop: 12 }}>
          The API reports {reportedTotal} sales but returned only {allSalesCount}. The missing {paginationGap} record
          {paginationGap === 1 ? " is" : "s are"} probably behind backend pagination.
        </div>
      ) : null}

      {unknownDateCount > 0 ? (
        <div className="errorBox" style={{ marginTop: 12 }}>
          {unknownDateCount} displayed sale{unknownDateCount === 1 ? " has" : "s have"} no recognised purchase date.
          Check the “Unknown month” group or inspect the raw API response below.
        </div>
      ) : null}

      {rawSalesResponse ? (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>Raw Sales API response (diagnostic)</summary>
          <div className="rowActions" style={{ marginTop: 10 }}>
            <button
              className="miniBtn"
              type="button"
              onClick={() => copyToClipboard(JSON.stringify(rawSalesResponse, null, 2))}
            >
              Copy raw response
            </button>
          </div>
          <pre className="debugPre" style={{ marginTop: 10, maxHeight: 360, overflow: "auto" }}>
            {JSON.stringify(rawSalesResponse, null, 2)}
          </pre>
        </details>
      ) : null}

      {salesLoading && !salesItems.length ? (
        <div className="empty fancyEmpty" style={{ marginTop: 12 }}>
          <div className="emptyIcon">💳</div>
          <div className="emptyTitle">Loading sales…</div>
          <div className="mutedSmall">Fetching the latest payment records.</div>
        </div>
      ) : null}

      {!salesLoading && !groupedSales.length ? (
        <div className="empty fancyEmpty" style={{ marginTop: 12 }}>
          <div className="emptyIcon">🧾</div>
          <div className="emptyTitle">No sales found</div>
          <div className="mutedSmall">
            Add VITE_SALES_API or clear the search filter to view purchase records.
          </div>
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
        {groupedSales.map((month, monthIndex) => {
          const monthOpen =
            expandedSaleMonths[month.monthKey] !== undefined
              ? expandedSaleMonths[month.monthKey]
              : monthIndex === 0;

          return (
            <div
              key={month.monthKey}
              className="card"
              style={{
                border: "1px solid rgba(245,158,11,0.26)",
                background: "rgba(245,158,11,0.045)",
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                onClick={() => toggleSaleMonth(month.monthKey)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "14px 16px",
                  background: monthOpen
                    ? "linear-gradient(180deg, rgba(245,158,11,0.20), rgba(245,158,11,0.10))"
                    : "linear-gradient(180deg, rgba(245,158,11,0.12), rgba(245,158,11,0.06))",
                  border: "none",
                  borderBottom: monthOpen ? "1px solid rgba(245,158,11,0.26)" : "none",
                  color: "rgba(255,255,255,0.96)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div>
                  <div style={{ fontWeight: 800 }}>{month.label}</div>
                  <div className="mutedSmall">
                    {month.count} sale{month.count > 1 ? "s" : ""} • {formatInr(month.totalAmount)}
                  </div>
                </div>
                <div style={{ fontSize: 18, transform: monthOpen ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 160ms ease" }}>
                  ▾
                </div>
              </button>

              {monthOpen ? (
                <div style={{ display: "grid", gap: 10, padding: 12 }}>
                  {month.dates.map((dateGroup, dateIndex) => {
                    const dateOpen =
                      expandedSaleDates[dateGroup.dateKey] !== undefined
                        ? expandedSaleDates[dateGroup.dateKey]
                        : monthIndex === 0 && dateIndex === 0;

                    return (
                      <div
                        key={dateGroup.dateKey}
                        className="card"
                        style={{
                          border: "1px solid rgba(255,255,255,0.10)",
                          background: "rgba(255,255,255,0.035)",
                          overflow: "hidden",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSaleDate(dateGroup.dateKey)}
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                            padding: "12px 14px",
                            background: dateOpen ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.025)",
                            border: "none",
                            borderBottom: dateOpen ? "1px solid rgba(255,255,255,0.10)" : "none",
                            color: "rgba(255,255,255,0.94)",
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 700 }}>{dateGroup.label}</div>
                            <div className="mutedSmall">
                              {dateGroup.count} sale{dateGroup.count > 1 ? "s" : ""} • {formatInr(dateGroup.totalAmount)}
                            </div>
                          </div>
                          <div style={{ fontSize: 16, transform: dateOpen ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 160ms ease" }}>
                            ▾
                          </div>
                        </button>

                        {dateOpen ? (
                          <div style={{ padding: 12 }}>
                            <div className="tableWrap">
                              <table className="table">
                                <thead>
                                  <tr>
                                    <th style={{ width: 150 }}>Time</th>
                                    <th style={{ width: 140 }}>Mobile</th>
                                    <th style={{ width: 170 }}>Name</th>
                                    <th>Report details</th>
                                    <th style={{ width: 110 }}>Amount</th>
                                    <th style={{ width: 105 }}>Status</th>
                                    <th style={{ width: 220 }}>Payment</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {dateGroup.items.map((sale) => {
                                    const dt = sale.saleDate ? new Date(sale.saleDate) : null;
                                    const timeStr = dt && !Number.isNaN(dt.getTime()) ? dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-";
                                    const st = prettyStatus(sale.status);

                                    return (
                                      <tr key={sale.id} className="row">
                                        <td className="mono">{timeStr}</td>
                                        <td className="mono">
                                          <div className="monoRow">
                                            <span>{sale.mobile || "-"}</span>
                                            {sale.mobile ? (
                                              <button className="miniBtn" onClick={() => copyToClipboard(sale.mobile)} type="button">
                                                Copy
                                              </button>
                                            ) : null}
                                          </div>
                                        </td>
                                        <td>{sale.name || "-"}</td>
                                        <td>
                                          <div className="titleCell">{sale.reportTitle}</div>
                                          <div className="mutedSmall">
                                            {[sale.reportType, sale.reportId].filter(Boolean).join(" • ") || "-"}
                                          </div>
                                        </td>
                                        <td className="mono">{formatInr(sale.amount)}</td>
                                        <td>
                                          <span className={clsx("badge", `st-${st}`)}>{sale.status || "paid"}</span>
                                        </td>
                                        <td className="mono">
                                          <div>{sale.paymentId || sale.orderId || "-"}</div>
                                          {(sale.paymentId || sale.orderId) ? (
                                            <button
                                              className="miniBtn"
                                              style={{ marginTop: 6 }}
                                              onClick={() => copyToClipboard(sale.paymentId || sale.orderId)}
                                              type="button"
                                            >
                                              Copy ID
                                            </button>
                                          ) : null}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
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
