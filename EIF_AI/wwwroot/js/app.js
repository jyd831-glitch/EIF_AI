const ACTOR_X = { Mes: 0, Eif: 1, Plc: 2 };

const state = {
  browsePath: "",
  browse: null,
  tree: null,
  modalPickPath: null,
  selectedFolder: null, // absolute path
  result: null,
  selectedId: null,
  expandedTree: new Set(),
  lotIds: [],
  lotSuggestIndex: -1,
};

const el = {
  folderPathInput: document.getElementById("folderPathInput"),
  browseFolderBtn: document.getElementById("browseFolderBtn"),
  folderModal: document.getElementById("folderModal"),
  folderModalBackdrop: document.getElementById("folderModalBackdrop"),
  folderModalClose: document.getElementById("folderModalClose"),
  folderModalCancel: document.getElementById("folderModalCancel"),
  folderModalOk: document.getElementById("folderModalOk"),
  modalFolderName: document.getElementById("modalFolderName"),
  folderTree: document.getElementById("folderTree"),
  explorerUp: document.getElementById("explorerUp"),
  explorerPath: document.getElementById("explorerPath"),
  explorerList: document.getElementById("explorerList"),
  lotInput: document.getElementById("lotInput"),
  lotSuggestions: document.getElementById("lotSuggestions"),
  includeBitOff: document.getElementById("includeBitOff"),
  loadBtn: document.getElementById("loadBtn"),
  stats: document.getElementById("stats"),
  topMeta: document.getElementById("topMeta"),
  emptyState: document.getElementById("emptyState"),
  seq: document.getElementById("seq"),
  seqSvg: document.getElementById("seqSvg"),
  detailBody: document.getElementById("detailBody"),
  detailPanel: document.getElementById("detailPanel"),
  closeDetail: document.getElementById("closeDetail"),
  app: document.querySelector(".app"),
};

function currentFolder() {
  return state.selectedFolder || "";
}

async function api(path) {
  const res = await fetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

function fmtTime(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleTimeString("ko-KR", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

function fmtDateTime(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR", { hour12: false });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function displayPath(path) {
  if (!path) return "이 PC";
  return path;
}

async function openModal() {
  el.folderModal.classList.remove("hidden");
  el.folderModal.setAttribute("aria-hidden", "false");
  state.modalPickPath = state.selectedFolder || null;
  try {
    state.tree = await api("/api/browse/tree");
    state.expandedTree.add("");
    renderTree();
    const start = state.selectedFolder || state.browsePath || (await api("/api/browse/default")).path || "";
    await loadBrowse(start);
  } catch (err) {
    el.stats.textContent = err.message;
  }
}

function closeModal() {
  el.folderModal.classList.add("hidden");
  el.folderModal.setAttribute("aria-hidden", "true");
}

async function loadBrowse(path = "") {
  const qs = path ? `?path=${encodeURIComponent(path)}` : "";
  state.browse = await api(`/api/browse${qs}`);
  state.browsePath = state.browse.currentPath || "";

  if (state.browse.currentIsSelectable) {
    state.modalPickPath = state.browsePath;
  }

  renderContent();
  await ensureTreePathExpanded(state.browsePath);
  highlightTree(state.modalPickPath || state.browsePath);
  updateModalSelection();
}

function openFolder(path) {
  loadBrowse(path || "").catch((err) => {
    el.stats.textContent = err.message;
  });
}

function selectPick(path) {
  state.modalPickPath = path;
  updateModalSelection();
  renderContent();
  highlightTree(path);
}

function canConfirm(path) {
  if (!path) return false;
  if (path === state.browsePath && state.browse?.currentIsSelectable) return true;
  const entry = (state.browse?.entries || []).find((e) => e.path === path);
  return !!(entry && entry.isSelectable);
}

function updateModalSelection() {
  const path = state.modalPickPath;
  el.modalFolderName.value = path ? displayPath(path) : "";
  el.folderModalOk.disabled = !canConfirm(path);
}

function renderTree() {
  if (!state.tree || !el.folderTree) return;
  el.folderTree.innerHTML = "";
  el.folderTree.appendChild(buildTreeNode(state.tree, 0));
}

function buildTreeNode(node, depth) {
  const wrap = document.createElement("div");
  wrap.className = `tree-node${state.expandedTree.has(node.path) ? " open" : ""}`;
  wrap.dataset.path = node.path;

  const row = document.createElement("div");
  row.className = "tree-row";
  row.style.paddingLeft = `${depth * 12 + 4}px`;

  const twist = document.createElement("span");
  twist.className = "tree-twist";
  twist.textContent = node.hasChildren ? (state.expandedTree.has(node.path) ? "▼" : "▶") : "";

  const icon = document.createElement("span");
  icon.className = "tree-icon";

  const label = document.createElement("span");
  label.textContent = node.name;

  row.appendChild(twist);
  row.appendChild(icon);
  row.appendChild(label);

  row.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (e.target === twist && node.hasChildren) {
      await toggleTreeNode(node, wrap, twist);
      return;
    }
    openFolder(node.path);
    if (node.isSelectable) selectPick(node.path);
    else {
      state.modalPickPath = node.path;
      updateModalSelection();
      highlightTree(node.path);
    }
  });

  twist.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!node.hasChildren) return;
    await toggleTreeNode(node, wrap, twist);
  });

  wrap.appendChild(row);

  const kids = document.createElement("div");
  kids.className = "tree-children";
  kids.dataset.parent = node.path;
  if (node.children?.length) {
    for (const child of node.children) {
      kids.appendChild(buildTreeNode(child, depth + 1));
    }
  }
  wrap.appendChild(kids);
  return wrap;
}

async function toggleTreeNode(node, wrap, twist) {
  const open = wrap.classList.toggle("open");
  twist.textContent = open ? "▼" : "▶";
  if (open) {
    state.expandedTree.add(node.path);
    await loadTreeChildren(node, wrap);
  } else {
    state.expandedTree.delete(node.path);
  }
}

async function loadTreeChildren(node, wrap) {
  const kidsHost = wrap.querySelector(":scope > .tree-children");
  if (!kidsHost) return;
  if (kidsHost.childElementCount > 0) return;

  try {
    const qs = node.path ? `?path=${encodeURIComponent(node.path)}` : "";
    const children = await api(`/api/browse/tree${qs}`);
    const list = Array.isArray(children) ? children : (children.children || []);
    node.children = list;
    const depth = (node.path ? node.path.split(/[\\/]/).filter(Boolean).length : 0);
    for (const child of list) {
      kidsHost.appendChild(buildTreeNode(child, depth + (node.path ? 0 : 0) + (node.path === "" ? 1 : 1)));
    }
  } catch (err) {
    kidsHost.innerHTML = `<div class="muted" style="padding:0.25rem 0.5rem;font-size:0.75rem;">${escapeHtml(err.message)}</div>`;
  }
}

async function ensureTreePathExpanded(path) {
  if (!path || !state.tree) return;
  // Expand drive root first
  const drive = path.match(/^[A-Za-z]:\\/)?.[0];
  if (drive) {
    state.expandedTree.add("");
    state.expandedTree.add(drive);
    const driveNode = state.tree.children?.find((c) =>
      c.path.replace(/\\+$/, "").toLowerCase() === drive.replace(/\\+$/, "").toLowerCase()
      || c.path.toLowerCase() === drive.toLowerCase());
    if (driveNode) {
      const wrap = el.folderTree.querySelector(`.tree-node[data-path="${cssPath(driveNode.path)}"]`);
      if (wrap) {
        wrap.classList.add("open");
        await loadTreeChildren(driveNode, wrap);
      }
    }
  }
  // Expand intermediate folders lazily by walking
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) return;
  let acc = parts[0].endsWith(":") ? parts[0] + "\\" : parts[0];
  for (let i = 1; i < parts.length; i++) {
    acc = acc.endsWith("\\") ? acc + parts[i] : acc + "\\" + parts[i];
    state.expandedTree.add(acc);
  }
  renderTree();
}

function cssPath(path) {
  // dataset attribute selector escape
  return path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function highlightTree(path) {
  el.folderTree?.querySelectorAll(".tree-row.active").forEach((n) => n.classList.remove("active"));
  if (path == null) return;
  const node = el.folderTree?.querySelector(`.tree-node[data-path="${cssPath(path)}"] > .tree-row`);
  if (node) node.classList.add("active");
}

function renderContent() {
  const data = state.browse;
  if (!data) return;

  el.explorerPath.textContent = data.isComputerRoot ? "이 PC" : displayPath(data.currentPath);
  el.explorerUp.disabled = data.isComputerRoot;
  el.explorerList.innerHTML = "";

  const dirs = (data.entries || []).filter((e) => e.isDirectory);
  const files = (data.entries || []).filter((e) => !e.isDirectory);

  if (!dirs.length && !files.length) {
    el.explorerList.innerHTML = `<div class="win-empty">이 폴더는 비어 있습니다.</div>`;
    return;
  }

  for (const entry of dirs) {
    const tags = [];
    if (entry.hasSfc) tags.push("SFC");
    if (entry.hasSolace) tags.push("SOLACE");
    if (entry.hasTrace) tags.push("TRACE");

    const item = document.createElement("button");
    item.type = "button";
    item.className = `win-item${state.modalPickPath === entry.path ? " active" : ""}`;
    item.innerHTML = `
      <span class="win-folder-icon"></span>
      <span class="win-item-name">${escapeHtml(entry.name)}</span>
      <span class="win-item-tag">${entry.isSelectable ? tags.join("+") : ""}</span>
    `;
    item.addEventListener("click", () => selectPick(entry.path));
    item.addEventListener("dblclick", () => openFolder(entry.path));
    el.explorerList.appendChild(item);
  }

  for (const entry of files) {
    const item = document.createElement("div");
    item.className = "win-item file";
    item.innerHTML = `
      <span class="win-file-icon"></span>
      <span class="win-item-name">${escapeHtml(entry.name)}</span>
    `;
    el.explorerList.appendChild(item);
  }
}

function applySelectedFolder(path) {
  state.selectedFolder = path || null;
  el.folderPathInput.value = path || "";
  state.lotIds = [];
  hideLotSuggestions();

  if (!path) {
    el.stats.textContent = "로그 폴더를 선택하세요.";
    el.topMeta.textContent = "로그 폴더를 선택하세요";
    return;
  }

  el.topMeta.textContent = `${path} · LOTID 입력 후 작성`;
  el.stats.textContent = `선택 폴더: ${path}`;
  prefetchLotSuggestions();
}

async function prefetchLotSuggestions() {
  const folder = currentFolder();
  if (!folder) return;
  try {
    const lots = await api(`/api/lots?folder=${encodeURIComponent(folder)}`);
    state.lotIds = Array.isArray(lots) ? lots : (lots.lots || lots.lotIds || []);
  } catch {
    state.lotIds = [];
  }
}

function filteredLotIds() {
  const q = el.lotInput.value.trim().toLowerCase();
  const all = state.lotIds || [];
  if (!q) return all.slice(0, 80);
  return all.filter((lot) => String(lot).toLowerCase().includes(q)).slice(0, 80);
}

function showLotSuggestions() {
  const items = filteredLotIds();
  const list = el.lotSuggestions;
  list.innerHTML = "";
  state.lotSuggestIndex = -1;

  if (!items.length) {
    list.hidden = true;
    return;
  }

  for (const lot of items) {
    const li = document.createElement("li");
    li.textContent = lot;
    li.tabIndex = -1;
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      pickLot(lot);
    });
    list.appendChild(li);
  }
  list.hidden = false;
  positionLotSuggestions();
}

function positionLotSuggestions() {
  const list = el.lotSuggestions;
  if (!list || list.hidden) return;
  const rect = el.lotInput.getBoundingClientRect();
  const maxH = Math.min(220, Math.max(120, window.innerHeight - rect.bottom - 12));
  list.style.position = "fixed";
  list.style.left = `${Math.round(rect.left)}px`;
  list.style.top = `${Math.round(rect.bottom + 4)}px`;
  list.style.width = `${Math.round(rect.width)}px`;
  list.style.right = "auto";
  list.style.maxHeight = `${maxH}px`;
  list.style.zIndex = "1000";
}

function hideLotSuggestions() {
  if (!el.lotSuggestions) return;
  el.lotSuggestions.hidden = true;
  el.lotSuggestions.innerHTML = "";
  state.lotSuggestIndex = -1;
}

function pickLot(lot) {
  el.lotInput.value = lot;
  hideLotSuggestions();
  el.lotInput.focus();
}

function highlightLotSuggest(delta) {
  const items = [...el.lotSuggestions.querySelectorAll("li")];
  if (!items.length) return;
  state.lotSuggestIndex = Math.max(
    -1,
    Math.min(items.length - 1, state.lotSuggestIndex + delta)
  );
  items.forEach((li, i) => li.classList.toggle("active", i === state.lotSuggestIndex));
  if (state.lotSuggestIndex >= 0) {
    items[state.lotSuggestIndex].scrollIntoView({ block: "nearest" });
  }
}

async function loadTimeFloor() {
  const lotId = el.lotInput.value.trim();
  const folder = currentFolder();
  if (!folder) {
    el.emptyState.hidden = false;
    el.seq.hidden = true;
    el.emptyState.textContent = "찾아보기로 로그 폴더를 먼저 선택하세요.";
    openModal();
    return;
  }
  if (!lotId) {
    el.emptyState.hidden = false;
    el.seq.hidden = true;
    el.emptyState.textContent = "LOTID를 입력하세요.";
    el.lotInput.focus();
    return;
  }

  el.loadBtn.disabled = true;
  el.loadBtn.textContent = "작성 중…";
  el.emptyState.hidden = false;
  el.emptyState.textContent = "로그 파싱 및 시퀀스 작성 중…";
  el.seq.hidden = true;

  try {
    const params = new URLSearchParams({
      folder,
      lotId,
      includeBitOff: String(el.includeBitOff.checked),
      limit: "2000",
    });
    state.result = await api(`/api/timefloor?${params}`);
    if (Array.isArray(state.result.lotIds) && state.result.lotIds.length) {
      state.lotIds = state.result.lotIds;
    }
    renderSequence(state.result);
  } catch (err) {
    el.emptyState.textContent = `오류: ${err.message}`;
    el.stats.textContent = err.message;
  } finally {
    el.loadBtn.disabled = false;
    el.loadBtn.textContent = "타임플로어 작성";
  }
}

function actorIndex(actor) {
  return ACTOR_X[actor] ?? 1;
}

function renderSequence(result) {
  const messages = result.messages || [];
  el.stats.innerHTML = [
    `folder: ${result.logType || "-"}`,
    `LOT: ${result.lotId || "-"}`,
    `equipment: ${result.equipmentKey}`,
    `messages: ${messages.length}`,
    `events: ${result.totalEvents}`,
    `range: ${fmtDateTime(result.startTime)}`,
  ].join("<br>");
  el.topMeta.textContent = `${result.logType} · LOT ${result.lotId} · ${messages.length} messages`;

  if (!messages.length) {
    el.emptyState.hidden = false;
    el.emptyState.textContent = `LOTID "${result.lotId}" 에 해당하는 시퀀스가 없습니다.`;
    el.seq.hidden = true;
    return;
  }

  el.emptyState.hidden = true;
  el.seq.hidden = false;

  const width = 840;
  const padX = 70;
  const colGap = (width - padX * 2) / 2;
  const xs = [padX, padX + colGap, padX + colGap * 2];
  const rowH = 62;
  const top = 6;
  const height = Math.max(top + messages.length * rowH + 36, 80);

  // Align MES/EIF/PLC boxes to SVG lifeline X positions
  const heads = el.seq?.querySelector(".seq-heads");
  if (heads) {
    const actors = heads.querySelectorAll(".actor");
    actors.forEach((node, i) => {
      if (xs[i] == null) return;
      node.style.left = `${((xs[i] / width) * 100).toFixed(4)}%`;
    });
  }

  const svg = el.seqSvg;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", String(height));
  svg.setAttribute("preserveAspectRatio", "xMidYMin meet");
  svg.style.height = "auto";
  svg.innerHTML = "";

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.innerHTML = `
    <marker id="arrowHead" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
      <path d="M0,0 L7,3 L0,6 Z" fill="#2f6fdb" />
    </marker>
    <marker id="arrowHeadAlarm" markerWidth="10" markerHeight="10" refX="8" refY="3.5" orient="auto">
      <path d="M0,0 L8,3.5 L0,7 Z" fill="#d32f2f" />
    </marker>
  `;
  svg.appendChild(defs);

  for (let i = 0; i < 3; i++) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", xs[i]);
    line.setAttribute("x2", xs[i]);
    line.setAttribute("y1", 0);
    line.setAttribute("y2", height - 14);
    line.setAttribute("stroke", "#222");
    line.setAttribute("stroke-width", "1.4");
    svg.appendChild(line);

    const tip = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    const x = xs[i];
    const y = height - 14;
    tip.setAttribute("points", `${x - 5},${y - 10} ${x + 5},${y - 10} ${x},${y}`);
    tip.setAttribute("fill", "#222");
    svg.appendChild(tip);
  }

  const bottom = document.createElementNS("http://www.w3.org/2000/svg", "line");
  bottom.setAttribute("x1", 24);
  bottom.setAttribute("x2", width - 24);
  bottom.setAttribute("y1", height - 6);
  bottom.setAttribute("y2", height - 6);
  bottom.setAttribute("stroke", "#333");
  bottom.setAttribute("stroke-width", "1.2");
  svg.appendChild(bottom);

  messages.forEach((msg, idx) => {
    const y = top + idx * rowH + 22;
    const x1 = xs[actorIndex(msg.from)];
    const x2 = xs[actorIndex(msg.to)];
    const midX = (x1 + x2) / 2;
    const isAlarm = !!(msg.isAlarm || msg.IsAlarm);

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.classList.add("msg-hit");
    if (isAlarm) g.classList.add("alarm");

    const hit = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    hit.setAttribute("x", Math.min(x1, x2) - 8);
    hit.setAttribute("y", y - 28);
    hit.setAttribute("width", Math.abs(x2 - x1) + 16);
    hit.setAttribute("height", 56);
    hit.setAttribute("fill", "transparent");
    g.appendChild(hit);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.classList.add("msg-label");
    label.setAttribute("x", midX);
    label.setAttribute("y", y - 10);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-size", isAlarm ? "14" : "13");
    label.setAttribute("font-family", "IBM Plex Sans, Segoe UI, sans-serif");
    label.setAttribute("font-weight", isAlarm ? "700" : "400");
    label.setAttribute("fill", isAlarm ? "#c62828" : "#1c2430");
    label.textContent = msg.label;
    g.appendChild(label);

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.classList.add("msg-line");
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y);
    line.setAttribute("stroke", isAlarm ? "#d32f2f" : "#2f6fdb");
    line.setAttribute("stroke-width", isAlarm ? "3.2" : "1.8");
    line.setAttribute("marker-end", isAlarm ? "url(#arrowHeadAlarm)" : "url(#arrowHead)");
    g.appendChild(line);

    if (msg.subLabel) {
      const sub = document.createElementNS("http://www.w3.org/2000/svg", "text");
      sub.setAttribute("x", midX);
      sub.setAttribute("y", y + 16);
      sub.setAttribute("text-anchor", "middle");
      sub.setAttribute("font-size", "11");
      sub.setAttribute("font-family", "IBM Plex Mono, monospace");
      sub.setAttribute("fill", "#5f6e7f");
      sub.textContent = msg.subLabel;
      g.appendChild(sub);
    }

    const time = document.createElementNS("http://www.w3.org/2000/svg", "text");
    time.setAttribute("x", 8);
    time.setAttribute("y", y + 4);
    time.setAttribute("font-size", "10");
    time.setAttribute("font-family", "IBM Plex Mono, monospace");
    time.setAttribute("fill", "#8a97a6");
    time.textContent = fmtTime(msg.timestamp);
    g.appendChild(time);

    g.addEventListener("click", () => selectMessage(msg, g));
    svg.appendChild(g);
  });
}

function selectMessage(msg, group) {
  state.selectedId = msg.id;
  document.querySelectorAll(".msg-hit.active").forEach((n) => n.classList.remove("active"));
  group.classList.add("active");
  openDetailPanel();

  const isTrace = msg.source === "Trace" || msg.source === 1;
  const fieldsTitle = isTrace ? "Bit Fields" : "Fields";
  const rawTitle = isTrace ? "Bit Raw" : "Message Raw";

  const bitFields = Object.entries(msg.fields || {})
    .map(([k, v]) => `<div>${escapeHtml(k)}</div><div>${escapeHtml(formatFieldValue(v))}</div>`)
    .join("");

  const wordFields = Object.entries(msg.wordFields || {})
    .map(([k, v]) => `<div>${escapeHtml(k)}</div><div>${escapeHtml(formatFieldValue(v))}</div>`)
    .join("");

  const hasWord = !!(msg.wordFields && Object.keys(msg.wordFields).length) || !!msg.wordRawSnippet;
  const rawHtml = renderRawBlock(msg.rawSnippet);
  const wordRawHtml = renderRawBlock(msg.wordRawSnippet);

  const wordSection = hasWord
    ? `
    <h3 class="detail-section-title">Word Data</h3>
    <div class="kv">
      <div>Signal</div><div>${escapeHtml(msg.wordSignal || "-")}</div>
      <div>Time</div><div>${fmtDateTime(msg.wordTimestamp)}</div>
    </div>
    <div class="kv" style="margin-top:0.5rem;">${wordFields || '<div class="muted">필드 없음</div>'}</div>
    ${wordRawHtml ? `<div class="raw-wrap" style="margin-top:0.5rem;">${wordRawHtml}</div>` : ""}
    `
    : isTrace
      ? `
    <h3 class="detail-section-title">Word Data</h3>
    <p class="muted">매칭되는 Word 데이터 없음</p>
    `
      : "";

  el.detailBody.innerHTML = `
    <div class="kv">
      <div>Time</div><div>${fmtDateTime(msg.timestamp)}</div>
      <div>From</div><div>${escapeHtml(msg.from)} → ${escapeHtml(msg.to)}</div>
      <div>Label</div><div>${escapeHtml(msg.label || "")}</div>
      <div>Sub</div><div>${escapeHtml(msg.subLabel || "-")}</div>
      <div>Source</div><div>${escapeHtml(String(msg.source))}</div>
      <div>Signal</div><div>${escapeHtml(msg.signal || "-")}</div>
      <div>Value</div><div>${escapeHtml(msg.value || "-")}</div>
      <div>LOTID</div><div>${escapeHtml(msg.lotId || "-")}</div>
      <div>POSITION</div><div>${escapeHtml(msg.position || "-")}</div>
    </div>
    <h3 class="detail-section-title">${fieldsTitle}</h3>
    <div class="kv">${bitFields || '<div class="muted">없음</div>'}</div>
    <h3 class="detail-section-title">${rawTitle}</h3>
    <div class="raw-wrap">${rawHtml || '<p class="muted">없음</p>'}</div>
    ${wordSection}
  `;
}

function formatFieldValue(v) {
  if (v == null) return "";
  const s = String(v);
  if (s.length > 120 && looksLikeJson(s.trim())) {
    try {
      return JSON.stringify(expandNestedJsonStrings(JSON.parse(s.trim())), null, 2);
    } catch {
      return s;
    }
  }
  return s;
}

function renderRawBlock(raw) {
  if (!raw) return "";
  const pretty = prettyRawSnippet(raw);
  return `<pre class="raw">${escapeHtml(pretty)}</pre>`;
}

function prettyRawSnippet(raw) {
  const text = String(raw).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) return "";

  // SOLACE / log header + payload: "... ) : {json}" or "... ) : <xml>"
  const sep = text.match(/\s:\s(?=[{\[<])/);
  if (sep && sep.index != null) {
    const header = text.slice(0, sep.index).trimEnd();
    const body = text.slice(sep.index + sep[0].length).trim();
    const formatted = formatPayload(body);
    if (formatted) return `${header}\n${formatted}`;
  }

  return formatPayload(text) || text;
}

function formatPayload(body) {
  const t = body.trim();
  if (!t) return "";

  if (looksLikeJson(t)) {
    try {
      const obj = expandNestedJsonStrings(JSON.parse(t));
      return JSON.stringify(obj, null, 2);
    } catch {
      // fall through
    }
  }

  if (t.startsWith("<")) {
    const xml = tryPrettyXml(t);
    if (xml) return xml;
  }

  // Unescape common log escape sequences for readability
  return t
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "  ")
    .replace(/\\"/g, '"');
}

function looksLikeJson(s) {
  return (s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"));
}

function expandNestedJsonStrings(value, depth = 0) {
  if (depth > 8) return value;

  if (typeof value === "string") {
    let s = value.trim();
    // Some payloads keep literal \r\n inside the string
    if (s.includes("\\r\\n") || s.includes("\\n") || s.includes('\\"')) {
      s = s
        .replace(/\\r\\n/g, "\n")
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"');
      s = s.trim();
    }
    if (looksLikeJson(s)) {
      try {
        return expandNestedJsonStrings(JSON.parse(s), depth + 1);
      } catch {
        return value;
      }
    }
    // XML-ish string content: keep as multi-line string
    if (s.startsWith("<") && s.includes("</")) {
      return tryPrettyXml(s) || s;
    }
    return s === value.trim() ? value : s;
  }

  if (Array.isArray(value)) {
    return value.map((v) => expandNestedJsonStrings(v, depth + 1));
  }

  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = expandNestedJsonStrings(v, depth + 1);
    }
    return out;
  }

  return value;
}

function tryPrettyXml(xml) {
  try {
    const normalized = xml.replace(/>\s+</g, "><").trim();
    const tokens = normalized.replace(/(>)(<)(\/*)/g, "$1\n$2$3").split("\n");
    let indent = 0;
    const lines = [];
    for (const token of tokens) {
      if (/^<\/.+/.test(token)) indent = Math.max(indent - 1, 0);
      lines.push(`${"  ".repeat(indent)}${token}`);
      if (/^<[^!?/][^>]*[^/]>$/.test(token)) indent += 1;
    }
    return lines.join("\n");
  } catch {
    return null;
  }
}

el.loadBtn.addEventListener("click", loadTimeFloor);
el.lotInput.addEventListener("focus", () => showLotSuggestions());
el.lotInput.addEventListener("input", () => showLotSuggestions());
el.lotInput.addEventListener("blur", () => {
  // delay so mousedown on item can fire first
  setTimeout(hideLotSuggestions, 120);
});
window.addEventListener("resize", () => {
  if (!el.lotSuggestions.hidden) positionLotSuggestions();
});
document.querySelector(".sidebar")?.addEventListener("scroll", () => {
  if (!el.lotSuggestions.hidden) positionLotSuggestions();
}, { passive: true });
el.lotInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const items = [...el.lotSuggestions.querySelectorAll("li")];
    if (!el.lotSuggestions.hidden && state.lotSuggestIndex >= 0 && items[state.lotSuggestIndex]) {
      e.preventDefault();
      pickLot(items[state.lotSuggestIndex].textContent);
      return;
    }
    hideLotSuggestions();
    loadTimeFloor();
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (el.lotSuggestions.hidden) showLotSuggestions();
    highlightLotSuggest(1);
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    highlightLotSuggest(-1);
    return;
  }
  if (e.key === "Escape") {
    hideLotSuggestions();
  }
});
el.browseFolderBtn.addEventListener("click", openModal);
el.folderPathInput.addEventListener("click", openModal);
el.folderModalClose.addEventListener("click", closeModal);
el.folderModalCancel.addEventListener("click", closeModal);
el.folderModalBackdrop.addEventListener("click", closeModal);
el.folderModalOk.addEventListener("click", () => {
  if (!state.modalPickPath || el.folderModalOk.disabled) return;
  applySelectedFolder(state.modalPickPath);
  closeModal();
});
el.explorerUp.addEventListener("click", () => {
  if (state.browse?.isComputerRoot) return;
  const parent = state.browse?.parentPath;
  // Drive root parent is null → computer
  openFolder(parent == null ? "" : parent);
});
el.closeDetail.addEventListener("click", () => {
  closeDetailPanel();
});

function openDetailPanel() {
  el.app?.classList.add("detail-open");
  if (el.detailPanel) el.detailPanel.hidden = false;
}

function closeDetailPanel() {
  el.app?.classList.remove("detail-open");
  if (el.detailPanel) el.detailPanel.hidden = true;
  el.detailBody.innerHTML = `<p class="muted">메시지 NAME을 클릭하면 상세 내용이 표시됩니다.</p>`;
  document.querySelectorAll(".msg-hit.active").forEach((n) => n.classList.remove("active"));
  state.selectedId = null;
}

// Prefill with project LOG default if available (user can change via browser)
api("/api/browse/default").then(async (d) => {
  if (!d.path) return;
  // Prefer SFCTYPE under default LOG
  try {
    const listing = await api(`/api/browse?path=${encodeURIComponent(d.path)}`);
    const sfc = (listing.entries || []).find((e) => e.isSelectable && /SFCTYPE/i.test(e.name))
      || (listing.entries || []).find((e) => e.isSelectable);
    if (sfc) applySelectedFolder(sfc.path);
    else if (listing.currentIsSelectable) applySelectedFolder(listing.currentPath);
  } catch {
    // ignore
  }
}).catch(() => {});
