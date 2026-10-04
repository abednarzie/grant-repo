// Grant Tracker — app logic. All data goes through the Supabase JS client.
// Auth gates the app; data is per-user via RLS (user_id = auth.uid()).

import { supabase } from "./supabaseClient.js";
import { initAuth, onReady } from "./auth.js";

// ── State ───────────────────────────────────────────────────────────────────
let allOpportunities = [];
let fundingAreas = [];
let allActions = [];
let overallTarget = 0;
let currentOpp = null;

// ── Element refs ────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const dashboardView = () => $("dashboardView");
const detailView    = () => $("detailView");
const toast         = () => $("toast");

// ── Helpers ─────────────────────────────────────────────────────────────────

function esc(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function statusClass(status) { return status.replace(/\s+/g, ""); }

function parseAmount(text) {
  if (text == null) return 0;
  const cleaned = String(text).replace(/[^0-9.]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function money(n) {
  const v = Number(n) || 0;
  return "$" + v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function showToast(msg, isError = false) {
  const t = toast();
  t.textContent = msg;
  t.className = "toast" + (isError ? " error" : "");
  setTimeout(() => t.classList.add("hidden"), 2600);
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString(undefined,
      { year: "numeric", month: "short", day: "numeric" });
  } catch { return iso; }
}

function daysUntil(iso) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(iso + "T00:00:00");
  return Math.round((d - today) / 86400000);
}

// Normalize empty strings to null for optional date/text columns.
function nn(v) { return v === "" ? null : v; }

// ── Data layer (Supabase) ─────────────────────────────────────────────────────

async function fetchFundingAreas() {
  const { data, error } = await supabase
    .from("funding_areas").select("*").order("name");
  if (error) throw error;
  return data;
}

async function fetchOpportunities() {
  const { data, error } = await supabase
    .from("opportunities")
    .select("*, funding_areas(name), requirements(status)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  // Flatten the joined funding area name + requirement roll-up counts.
  return data.map(o => {
    const reqs = o.requirements || [];
    const done = reqs.filter(r => r.status === "Complete" || r.status === "N/A").length;
    return {
      ...o,
      funding_area_name: o.funding_areas ? o.funding_areas.name : null,
      req_total: reqs.length,
      req_done: done,
    };
  });
}

async function fetchActions() {
  const { data, error } = await supabase
    .from("actions").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  // Sort Done to the bottom, preserving recency within each group.
  return data.sort((a, b) =>
    (a.status === "Done") - (b.status === "Done"));
}

async function fetchOverallTarget() {
  const { data, error } = await supabase
    .from("settings").select("value").eq("key", "overall_target").maybeSingle();
  if (error) throw error;
  return parseAmount(data ? data.value : 0);
}

// Compute dashboard stats client-side from the loaded data.
function computeStats() {
  const by_status = {};
  let awarded_total = 0, pipeline_total = 0;

  allOpportunities.forEach(o => {
    by_status[o.status] = (by_status[o.status] || 0) + 1;
    const amt = parseAmount(o.amount);
    if (o.status === "Awarded") awarded_total += amt;
    else if (o.status !== "Declined") pipeline_total += amt;
  });

  // Upcoming deadlines (overdue + next 60 days, excluding Awarded/Declined)
  const upcoming = [];
  allOpportunities.forEach(o => {
    if (o.deadline && o.status !== "Awarded" && o.status !== "Declined") {
      const days = daysUntil(o.deadline);
      if (days >= -3650 && days <= 60) {
        upcoming.push({ id: o.id, name: o.name, deadline: o.deadline,
                        days_left: days, status: o.status });
      }
    }
  });
  upcoming.sort((a, b) => a.days_left - b.days_left);

  // Per-bucket rollups
  const buckets = fundingAreas.map(a => {
    let b_awarded = 0, b_pipeline = 0, count = 0;
    allOpportunities.forEach(o => {
      if (o.funding_area_id === a.id) {
        count++;
        const amt = parseAmount(o.amount);
        if (o.status === "Awarded") b_awarded += amt;
        else if (o.status !== "Declined") b_pipeline += amt;
      }
    });
    return { id: a.id, name: a.name, target: Number(a.target) || 0,
             awarded: b_awarded, pipeline: b_pipeline, opportunity_count: count };
  });

  const open_actions = allActions.filter(a => a.status !== "Done").length;

  // Requirement completion across all opportunities
  let req_total = 0, req_done = 0;
  allOpportunities.forEach(o => { req_total += o.req_total; req_done += o.req_done; });

  return { total_opportunities: allOpportunities.length, by_status, upcoming,
           awarded_total, pipeline_total, overall_target: overallTarget,
           buckets, open_actions, req_total, req_done };
}

// ── Load dashboard ────────────────────────────────────────────────────────────

async function loadDashboard() {
  try {
    [fundingAreas, allOpportunities, allActions, overallTarget] = await Promise.all([
      fetchFundingAreas(),
      fetchOpportunities(),
      fetchActions(),
      fetchOverallTarget(),
    ]);
  } catch (err) {
    showToast(err.message || "Failed to load data", true);
    return;
  }

  const stats = computeStats();
  renderStats(stats);
  renderTargets(stats);
  renderBuckets(stats);
  renderActions();
  renderDeadlines(stats.upcoming);
  populateAreaControls();
  renderOppTable();
}

// ── Stat cards ──────────────────────────────────────────────────────────────

function renderStats(stats) {
  const grid = $("statGrid");
  const reqPct = stats.req_total
    ? Math.round((stats.req_done / stats.req_total) * 100) : 0;

  const cards = [
    { num: stats.total_opportunities, label: "Opportunities", accent: "accent-blue" },
    { num: money(stats.awarded_total), label: "Awarded $",     accent: "accent-green" },
    { num: money(stats.pipeline_total), label: "Pipeline $",   accent: "accent-amber" },
    { num: stats.open_actions,        label: "Open actions",   accent: "accent-purple" },
    { num: reqPct + "%",              label: "Reqs complete",  accent: "accent-green" },
  ];
  grid.innerHTML = cards.map(c => `
    <div class="stat-card ${c.accent}">
      <div class="stat-num">${c.num}</div>
      <div class="stat-label">${c.label}</div>
    </div>`).join("");
}

// ── Overall target ──────────────────────────────────────────────────────────

function renderTargets(stats) {
  $("overallTargetDisplay").textContent = money(stats.overall_target);
  const target = Number(stats.overall_target) || 0;
  const awarded = Number(stats.awarded_total) || 0;
  const pipeline = Number(stats.pipeline_total) || 0;

  const wrap = $("targetOverall");
  if (!target) {
    wrap.innerHTML = `<p class="empty-note">Set an overall target to track progress.</p>`;
    return;
  }
  const awPct = Math.min(100, (awarded / target) * 100);
  const ppPct = Math.min(100 - awPct, (pipeline / target) * 100);
  const totalPct = Math.round(((awarded + pipeline) / target) * 100);

  wrap.innerHTML = `
    <div class="to-row">
      <span><strong>${money(awarded)}</strong> awarded
        <span class="muted">+ ${money(pipeline)} pipeline</span></span>
      <span class="muted">${totalPct}% of ${money(target)}</span>
    </div>
    <div class="big-bar">
      <div class="seg-awarded" style="width:${awPct}%"></div>
      <div class="seg-pipeline" style="width:${ppPct}%"></div>
    </div>`;
}

$("editTargetBtn").addEventListener("click", () => {
  $("t_target").value = String(overallTarget || "");
  $("targetModal").classList.remove("hidden");
  $("t_target").focus();
});
$("targetCancel").addEventListener("click", () => $("targetModal").classList.add("hidden"));
$("targetForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const value = String(parseAmount($("t_target").value));
    const { error } = await supabase
      .from("settings")
      .upsert({ key: "overall_target", value }, { onConflict: "user_id,key" });
    if (error) throw error;
    showToast("Overall target updated");
    $("targetModal").classList.add("hidden");
    loadDashboard();
  } catch (err) { showToast(err.message, true); }
});

// ── Funding area buckets table ───────────────────────────────────────────────

function renderBuckets(stats) {
  const body = $("bucketTableBody");
  const empty = $("bucketEmpty");
  const buckets = stats.buckets || [];
  body.innerHTML = "";
  if (!buckets.length) { empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");

  buckets.forEach(b => {
    const target = Number(b.target) || 0;
    const awarded = Number(b.awarded) || 0;
    const pipeline = Number(b.pipeline) || 0;
    const awPct = target ? Math.min(100, (awarded / target) * 100) : 0;
    const ppPct = target ? Math.min(100 - awPct, (pipeline / target) * 100) : 0;
    const pctLabel = target ? Math.round(((awarded + pipeline) / target) * 100) + "%" : "—";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="opp-name">${esc(b.name)}</td>
      <td class="money">${target ? money(target) : "—"}</td>
      <td class="money awarded">${money(awarded)}</td>
      <td class="money">${money(pipeline)}</td>
      <td>
        <div class="bucket-prog-wrap">
          <div class="bucket-prog">
            <div class="seg-awarded" style="width:${awPct}%"></div>
            <div class="seg-pipeline" style="width:${ppPct}%"></div>
          </div>
          <span class="bucket-prog-label">${pctLabel}</span>
        </div>
      </td>
      <td>${b.opportunity_count}</td>
      <td>
        <button class="icon-btn edit" title="Edit" data-edit="${b.id}">✎</button>
        <button class="icon-btn del" title="Delete" data-del="${b.id}">🗑</button>
      </td>`;

    tr.querySelector("[data-edit]").addEventListener("click", () => {
      openAreaModal(fundingAreas.find(a => a.id === b.id));
    });
    tr.querySelector("[data-del]").addEventListener("click", async () => {
      if (!confirm(`Delete funding area "${b.name}"? Opportunities stay but become unassigned.`)) return;
      try {
        const { error } = await supabase.from("funding_areas").delete().eq("id", b.id);
        if (error) throw error;
        showToast("Funding area deleted");
        loadDashboard();
      } catch (err) { showToast(err.message, true); }
    });
    body.appendChild(tr);
  });
}

// ── Actions tracker ───────────────────────────────────────────────────────────

function renderActions() {
  const list = $("actionList");
  const empty = $("actionEmpty");
  const prog = $("actionProgress");

  const done = allActions.filter(a => a.status === "Done").length;
  prog.textContent = allActions.length ? `${done}/${allActions.length} done` : "";

  list.innerHTML = "";
  if (!allActions.length) { empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");

  const statusOptions = ["Open", "In progress", "Blocked", "Done"];

  allActions.forEach(a => {
    const isDone = a.status === "Done";
    const sub = [];
    if (a.owner) sub.push("👤 " + esc(a.owner));
    if (a.due_date) sub.push("📅 " + fmtDate(a.due_date));
    if (a.notes) sub.push(esc(a.notes));

    const item = document.createElement("div");
    item.className = "action-item st-" + statusClass(a.status) + (isDone ? " done" : "");
    item.innerHTML = `
      <div class="action-main">
        <div class="action-title">${esc(a.title)}</div>
        ${sub.length ? `<div class="action-sub">${sub.join(" · ")}</div>` : ""}
      </div>
      <select class="action-status-select">
        ${statusOptions.map(s => `<option ${s === a.status ? "selected" : ""}>${s}</option>`).join("")}
      </select>
      <div class="action-actions">
        <button class="icon-btn edit" title="Edit">✎</button>
        <button class="icon-btn del" title="Delete">🗑</button>
      </div>`;

    item.querySelector(".action-status-select").addEventListener("change", async (e) => {
      try {
        const { error } = await supabase.from("actions")
          .update({ status: e.target.value }).eq("id", a.id);
        if (error) throw error;
        loadDashboard();
      } catch (err) { showToast(err.message, true); }
    });
    item.querySelector(".edit").addEventListener("click", () => openActionModal(a));
    item.querySelector(".del").addEventListener("click", async () => {
      if (!confirm("Delete this action?")) return;
      try {
        const { error } = await supabase.from("actions").delete().eq("id", a.id);
        if (error) throw error;
        showToast("Action deleted");
        loadDashboard();
      } catch (err) { showToast(err.message, true); }
    });
    list.appendChild(item);
  });
}

// ── Deadlines ─────────────────────────────────────────────────────────────────

function renderDeadlines(list) {
  const wrap = $("deadlineList");
  const empty = $("deadlineEmpty");
  wrap.innerHTML = "";
  if (!list || !list.length) { empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");

  list.forEach(d => {
    let badgeClass = "ok", badgeText;
    if (d.days_left < 0)        { badgeClass = "overdue"; badgeText = `${Math.abs(d.days_left)}d overdue`; }
    else if (d.days_left === 0) { badgeClass = "overdue"; badgeText = "Due today"; }
    else if (d.days_left <= 14) { badgeClass = "soon";    badgeText = `${d.days_left}d left`; }
    else                        { badgeClass = "ok";      badgeText = `${d.days_left}d left`; }

    const item = document.createElement("div");
    item.className = "deadline-item";
    item.innerHTML = `
      <div>
        <div class="dl-name">${esc(d.name)}</div>
        <div class="dl-date">${fmtDate(d.deadline)} · ${esc(d.status)}</div>
      </div>
      <span class="dl-badge ${badgeClass}">${badgeText}</span>`;
    item.addEventListener("click", () => openDetail(d.id));
    wrap.appendChild(item);
  });
}

// ── Area controls ──────────────────────────────────────────────────────────────

function populateAreaControls() {
  const optionsHtml = fundingAreas
    .map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("");

  const areaFilter = $("areaFilter");
  const prev = areaFilter.value;
  areaFilter.innerHTML = `<option value="">All areas</option>` + optionsHtml;
  areaFilter.value = prev;

  $("f_funding_area").innerHTML = `<option value="">— None —</option>` + optionsHtml;
}

// ── Opportunities table ─────────────────────────────────────────────────────────

function renderOppTable() {
  const body = $("oppTableBody");
  const empty = $("oppEmpty");
  const statusF = $("statusFilter").value;
  const areaF = $("areaFilter").value;

  let rows = allOpportunities;
  if (statusF) rows = rows.filter(o => o.status === statusF);
  if (areaF)   rows = rows.filter(o => String(o.funding_area_id) === String(areaF));

  body.innerHTML = "";
  if (!rows.length) { empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");

  rows.forEach(o => {
    const pct = o.req_total ? Math.round((o.req_done / o.req_total) * 100) : 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="opp-name">${esc(o.name)}</td>
      <td>${esc(o.funder) || "—"}</td>
      <td>${o.funding_area_name ? esc(o.funding_area_name) : "<span class='muted'>—</span>"}</td>
      <td>${esc(o.amount) || "—"}</td>
      <td><span class="badge ${esc(o.status)}">${esc(o.status)}</span></td>
      <td>${fmtDate(o.deadline)}</td>
      <td>
        <div class="req-bar-wrap">
          <div class="req-bar"><div class="req-bar-fill" style="width:${pct}%"></div></div>
          <span class="req-bar-label">${o.req_done}/${o.req_total}</span>
        </div>
      </td>
      <td><button class="row-del" title="Delete" data-del="${o.id}">×</button></td>`;

    tr.addEventListener("click", (e) => {
      if (e.target.closest("[data-del]")) return;
      openDetail(o.id);
    });
    tr.querySelector("[data-del]").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${o.name}" and all its requirements?`)) return;
      try {
        const { error } = await supabase.from("opportunities").delete().eq("id", o.id);
        if (error) throw error;
        showToast("Opportunity deleted");
        loadDashboard();
      } catch (err) { showToast(err.message, true); }
    });
    body.appendChild(tr);
  });
}

$("statusFilter").addEventListener("change", renderOppTable);
$("areaFilter").addEventListener("change", renderOppTable);

// ── Views ───────────────────────────────────────────────────────────────────

function showDashboard() {
  detailView().classList.add("hidden");
  dashboardView().classList.remove("hidden");
  currentOpp = null;
  loadDashboard();
}

async function openDetail(id) {
  try {
    const { data, error } = await supabase
      .from("opportunities")
      .select("*, funding_areas(name), requirements(*)")
      .eq("id", id).single();
    if (error) throw error;
    data.funding_area_name = data.funding_areas ? data.funding_areas.name : null;
    data.requirements = (data.requirements || [])
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    currentOpp = data;
    renderDetail();
    dashboardView().classList.add("hidden");
    detailView().classList.remove("hidden");
    window.scrollTo({ top: 0 });
  } catch (err) { showToast(err.message, true); }
}

function renderDetail() {
  const o = currentOpp;
  $("detailName").textContent = o.name;

  const meta = [];
  if (o.funder) meta.push(`<span><strong>Funder:</strong> ${esc(o.funder)}</span>`);
  if (o.amount) meta.push(`<span><strong>Aiming for:</strong> ${esc(o.amount)}</span>`);
  if (o.funding_area_name) meta.push(`<span><strong>Funding area:</strong> ${esc(o.funding_area_name)}</span>`);
  meta.push(`<span><strong>Status:</strong> <span class="badge ${esc(o.status)}">${esc(o.status)}</span></span>`);
  if (o.deadline) meta.push(`<span><strong>Deadline:</strong> ${fmtDate(o.deadline)}</span>`);
  if (o.source_url) meta.push(`<span><a href="${esc(o.source_url)}" target="_blank" rel="noopener">View source ↗</a></span>`);
  $("detailMeta").innerHTML = meta.join("");

  let body = "";
  if (o.specifically_funding) body += `<p><strong>Specifically funding:</strong> ${esc(o.specifically_funding)}</p>`;
  if (o.purpose) body += `<p style="margin-top:.5rem"><strong>Use for:</strong> ${esc(o.purpose)}</p>`;
  if (o.notes)   body += `<p class="muted" style="margin-top:.5rem">${esc(o.notes)}</p>`;
  $("detailPurpose").innerHTML = body;

  renderRequirements();
}

function renderRequirements() {
  const reqs = currentOpp.requirements || [];
  const list = $("reqList");
  const empty = $("reqEmpty");
  const prog = $("reqProgress");

  const done = reqs.filter(r => r.status === "Complete" || r.status === "N/A").length;
  prog.textContent = reqs.length ? `${done}/${reqs.length} done` : "";

  list.innerHTML = "";
  if (!reqs.length) { empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");

  const statusOptions = ["Not started", "In progress", "Complete", "N/A"];

  reqs.forEach(r => {
    const isDone = r.status === "Complete" || r.status === "N/A";
    const sub = [];
    if (r.owner) sub.push("👤 " + esc(r.owner));
    if (r.due_date) sub.push("📅 " + fmtDate(r.due_date));
    if (r.notes) sub.push(esc(r.notes));

    const item = document.createElement("div");
    item.className = "req-item" + (isDone ? " done" : "");
    item.innerHTML = `
      <div class="req-main">
        <div class="req-desc">${esc(r.description)}</div>
        ${sub.length ? `<div class="req-sub">${sub.join(" · ")}</div>` : ""}
      </div>
      <select class="req-status-select">
        ${statusOptions.map(s => `<option ${s === r.status ? "selected" : ""}>${s}</option>`).join("")}
      </select>
      <div class="req-actions">
        <button class="icon-btn edit" title="Edit">✎</button>
        <button class="icon-btn del" title="Delete">🗑</button>
      </div>`;

    item.querySelector(".req-status-select").addEventListener("change", async (e) => {
      try {
        const { error } = await supabase.from("requirements")
          .update({ status: e.target.value }).eq("id", r.id);
        if (error) throw error;
        await refreshCurrentOpp();
      } catch (err) { showToast(err.message, true); }
    });
    item.querySelector(".edit").addEventListener("click", () => openReqModal(r));
    item.querySelector(".del").addEventListener("click", async () => {
      if (!confirm("Delete this requirement?")) return;
      try {
        const { error } = await supabase.from("requirements").delete().eq("id", r.id);
        if (error) throw error;
        showToast("Requirement deleted");
        await refreshCurrentOpp();
      } catch (err) { showToast(err.message, true); }
    });
    list.appendChild(item);
  });
}

async function refreshCurrentOpp() {
  if (!currentOpp) return;
  await openDetail(currentOpp.id);
}

// ── Opportunity modal ──────────────────────────────────────────────────────────

function openOppModal(opp = null) {
  populateAreaControls();
  $("oppModalTitle").textContent = opp ? "Edit Opportunity" : "New Opportunity";
  $("oppId").value                  = opp ? opp.id : "";
  $("f_name").value                 = opp ? (opp.name || "") : "";
  $("f_funder").value               = opp ? (opp.funder || "") : "";
  $("f_amount").value               = opp ? (opp.amount || "") : "";
  $("f_funding_area").value         = opp && opp.funding_area_id ? String(opp.funding_area_id) : "";
  $("f_specifically_funding").value = opp ? (opp.specifically_funding || "") : "";
  $("f_source_url").value           = opp ? (opp.source_url || "") : "";
  $("f_purpose").value              = opp ? (opp.purpose || "") : "";
  $("f_status").value               = opp ? opp.status : "Identified";
  $("f_deadline").value             = opp ? (opp.deadline || "") : "";
  $("f_notes").value                = opp ? (opp.notes || "") : "";
  $("oppModal").classList.remove("hidden");
  $("f_name").focus();
}

function closeOppModal() { $("oppModal").classList.add("hidden"); }

$("newOppBtn").addEventListener("click", () => openOppModal());
$("oppCancel").addEventListener("click", closeOppModal);

$("oppForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("oppId").value;
  const record = {
    name:                 $("f_name").value.trim(),
    funder:               nn($("f_funder").value.trim()),
    amount:               nn($("f_amount").value.trim()),
    funding_area_id:      $("f_funding_area").value || null,
    specifically_funding: nn($("f_specifically_funding").value.trim()),
    source_url:           nn($("f_source_url").value.trim()),
    purpose:              nn($("f_purpose").value.trim()),
    status:               $("f_status").value,
    deadline:             nn($("f_deadline").value),
    notes:                nn($("f_notes").value.trim()),
  };
  try {
    if (id) {
      const { error } = await supabase.from("opportunities").update(record).eq("id", id);
      if (error) throw error;
      showToast("Opportunity updated");
      closeOppModal();
      if (currentOpp && String(currentOpp.id) === String(id)) await refreshCurrentOpp();
      else loadDashboard();
    } else {
      const { error } = await supabase.from("opportunities").insert(record);
      if (error) throw error;
      showToast("Opportunity created");
      closeOppModal();
      loadDashboard();
    }
  } catch (err) { showToast(err.message, true); }
});

$("editOppBtn").addEventListener("click", () => openOppModal(currentOpp));
$("deleteOppBtn").addEventListener("click", async () => {
  if (!currentOpp) return;
  if (!confirm(`Delete "${currentOpp.name}" and all its requirements?`)) return;
  try {
    const { error } = await supabase.from("opportunities").delete().eq("id", currentOpp.id);
    if (error) throw error;
    showToast("Opportunity deleted");
    showDashboard();
  } catch (err) { showToast(err.message, true); }
});

$("backBtn").addEventListener("click", showDashboard);

// ── Requirement modal ──────────────────────────────────────────────────────────

function openReqModal(req = null) {
  $("reqModalTitle").textContent = req ? "Edit Requirement" : "Add Requirement";
  $("reqId").value         = req ? req.id : "";
  $("r_description").value = req ? (req.description || "") : "";
  $("r_status").value      = req ? req.status : "Not started";
  $("r_owner").value       = req ? (req.owner || "") : "";
  $("r_due_date").value    = req ? (req.due_date || "") : "";
  $("r_notes").value       = req ? (req.notes || "") : "";
  $("reqModal").classList.remove("hidden");
  $("r_description").focus();
}

function closeReqModal() { $("reqModal").classList.add("hidden"); }

$("addReqBtn").addEventListener("click", () => openReqModal());
$("reqCancel").addEventListener("click", closeReqModal);

$("reqForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("reqId").value;
  const record = {
    description: $("r_description").value.trim(),
    status:      $("r_status").value,
    owner:       nn($("r_owner").value.trim()),
    due_date:    nn($("r_due_date").value),
    notes:       nn($("r_notes").value.trim()),
  };
  try {
    if (id) {
      const { error } = await supabase.from("requirements").update(record).eq("id", id);
      if (error) throw error;
      showToast("Requirement updated");
    } else {
      record.opportunity_id = currentOpp.id;
      const { error } = await supabase.from("requirements").insert(record);
      if (error) throw error;
      showToast("Requirement added");
    }
    closeReqModal();
    await refreshCurrentOpp();
  } catch (err) { showToast(err.message, true); }
});

// ── Action modal ──────────────────────────────────────────────────────────────

function openActionModal(action = null) {
  $("actionModalTitle").textContent = action ? "Edit Action" : "Add Action";
  $("actionId").value   = action ? action.id : "";
  $("a_title").value    = action ? (action.title || "") : "";
  $("a_status").value   = action ? action.status : "Open";
  $("a_owner").value    = action ? (action.owner || "") : "";
  $("a_due_date").value = action ? (action.due_date || "") : "";
  $("a_notes").value    = action ? (action.notes || "") : "";
  $("actionModal").classList.remove("hidden");
  $("a_title").focus();
}

function closeActionModal() { $("actionModal").classList.add("hidden"); }

$("newActionBtn").addEventListener("click", () => openActionModal());
$("addActionBtn").addEventListener("click", () => openActionModal());
$("actionCancel").addEventListener("click", closeActionModal);

$("actionForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("actionId").value;
  const record = {
    title:    $("a_title").value.trim(),
    status:   $("a_status").value,
    owner:    nn($("a_owner").value.trim()),
    due_date: nn($("a_due_date").value),
    notes:    nn($("a_notes").value.trim()),
  };
  try {
    if (id) {
      const { error } = await supabase.from("actions").update(record).eq("id", id);
      if (error) throw error;
      showToast("Action updated");
    } else {
      const { error } = await supabase.from("actions").insert(record);
      if (error) throw error;
      showToast("Action added");
    }
    closeActionModal();
    loadDashboard();
  } catch (err) { showToast(err.message, true); }
});

// ── Funding area modal ──────────────────────────────────────────────────────────

function openAreaModal(area = null) {
  $("areaModalTitle").textContent = area ? "Edit Funding Area" : "New Funding Area";
  $("areaId").value    = area ? area.id : "";
  $("fa_name").value   = area ? (area.name || "") : "";
  $("fa_target").value = area && area.target ? area.target : "";
  $("fa_notes").value  = area ? (area.notes || "") : "";
  $("areaModal").classList.remove("hidden");
  $("fa_name").focus();
}

function closeAreaModal() { $("areaModal").classList.add("hidden"); }

$("newAreaBtn").addEventListener("click", () => openAreaModal());
$("areaCancel").addEventListener("click", closeAreaModal);

$("areaForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("areaId").value;
  const record = {
    name:   $("fa_name").value.trim(),
    target: parseAmount($("fa_target").value),
    notes:  nn($("fa_notes").value.trim()),
  };
  try {
    if (id) {
      const { error } = await supabase.from("funding_areas").update(record).eq("id", id);
      if (error) throw error;
      showToast("Funding area updated");
    } else {
      const { error } = await supabase.from("funding_areas").insert(record);
      if (error) throw error;
      showToast("Funding area created");
    }
    closeAreaModal();
    loadDashboard();
  } catch (err) { showToast(err.message, true); }
});

// ── Close modals on overlay click ─────────────────────────────────────────────

["oppModal", "reqModal", "actionModal", "areaModal", "targetModal"].forEach(id => {
  $(id).addEventListener("click", (e) => {
    if (e.target.id === id) $(id).classList.add("hidden");
  });
});

// ── Init ────────────────────────────────────────────────────────────────────
// loadDashboard runs each time a user becomes active (sign-in / refresh).
onReady(loadDashboard);
initAuth();
