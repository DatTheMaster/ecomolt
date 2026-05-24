import type { BiomeType } from "@ecomolt/shared";

interface RegionSummary {
  id: string;
  name: string;
  biome: BiomeType;
  fertility: number;
  pollution: { air: number; water: number; ground: number };
  connections: string[];
  deposits: Record<string, number>;
  species: { plants: number; herbivores: number; predators: number; fish: number; insects: number };
  soilDepth: number;
  climate: { temperature: number; rainfall: number; sunlight: number };
}

interface CitizenSummary {
  id: string;
  name: string;
  regionId: string;
  health: number;
  alive: boolean;
  isBot: boolean;
  modelTag: string | null;
}

interface CitizenProfile {
  id: string;
  name: string;
  isBot: boolean;
  modelTag: string | null;
  seasonsPlayed: number;
  seasonsWon: number;
  reputation: number;
  titles: string[];
}

interface ProjectStageSummary {
  id: string;
  name: string;
  completed: boolean;
  requiredResources: Record<string, number>;
  contributedResources: Record<string, number>;
  requiredLabor: number;
  contributedLabor: number;
}

interface SeasonSummary {
  day: number;
  result: string;
  globalFootprint: number;
  projectCompleted: boolean;
  projectStage: number;
  aliveCitizens: number;
  totalCitizens: number;
  lawsEnacted: number;
  coordinatorId: string | null;
  treasury: number;
  regionSummaries: RegionSummary[];
  seasonNumber: number;
  intermission: boolean;
  previousSeasonId: string | null;
  timeline: TimelineSnapshot[];
}

interface TimelineSnapshot {
  day: number;
  globalFootprint: number;
  globalTemperature: number;
  aliveCitizens: number;
  avgPollution: { air: number; water: number; ground: number };
  totalSpecies: number;
  projectStageIndex: number;
  projectCompleted: boolean;
}

interface MarketListing {
  id: string;
  sellerId: string;
  sellerName: string;
  resourceType: string;
  quantity: number;
  pricePerUnit: number;
}

interface LawDetail {
  id: string;
  title: string;
  category: string;
  parameters: Record<string, number>;
  stringParams: Record<string, string>;
  enactedDay: number;
  proposer: string;
}

interface ArchiveSummary {
  season_id: string;
  result: string;
  day: number;
  event_count: number;
  archived_at: number;
}

interface ArchiveDetail {
  id: string;
  day: number;
  result: string;
  globalFootprint: number;
  projectCompleted: boolean;
  projectStage: number;
  aliveCitizens: number;
  totalCitizens: number;
  lawsEnacted: number;
  treasury: number;
  seasonNumber: number;
  timeline: TimelineSnapshot[];
  citizenProfiles: Array<{ id: string; name: string; isBot: boolean; modelTag: string | null; seasonsPlayed: number; seasonsWon: number; reputation: number; titles: string[] }>;
}

interface SeasonMetricsData {
  giniCoefficient: number;
  cooperationScore: number;
  governanceScore: number;
  survivalRate: number;
  avgReputation: number;
  perModel: Record<string, { count: number; avgReputation: number; survivalRate: number; contributionRate: number }>;
  perCitizen: Array<{ id: string; name: string; isBot: boolean; modelTag: string | null; credits: number; contributions: number; gathers: number; proposals: number; votes: number; alive: boolean; reputation: number }>;
}

interface CitizenDetailData {
  id: string;
  name: string;
  regionId: string;
  regionName: string;
  health: number;
  hunger: number;
  credits: number;
  inventory: Record<string, number>;
  skills: Record<string, number>;
  office: string | null;
  alive: boolean;
  isBot: boolean;
  modelTag: string | null;
  profile: { seasonsPlayed: number; seasonsWon: number; reputation: number; titles: string[] } | null;
  claims: Array<{ id: string; regionId: string; regionName: string; resourceType: string; claimedDay: number }>;
  recentEvents: Array<{ day: number; type: string; data: Record<string, unknown> }>;
}

type OverlayType = "pollution" | "fertility" | "species" | "citizens";

const API_BASE = location.port === "5173" ? "http://localhost:3000" : "";
const WS_URL = API_BASE.replace("http", "ws") || `ws://${location.host}`;

let profiles: CitizenProfile[] = [];
let laws: LawDetail[] = [];
let marketListings: MarketListing[] = [];
let archives: ArchiveSummary[] = [];
let currentOverlay: OverlayType = "pollution";
let refreshPaused = false;
let refreshIntervalMs = 10000;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let regions: RegionSummary[] = [];
let citizens: CitizenSummary[] = [];
let summary: SeasonSummary | null = null;
let recentEvents: Array<{ day: number; type: string; data: Record<string, unknown> }> = [];
let projectStages: ProjectStageSummary[] = [];
let projectCompleted = false;

const canvas = document.getElementById("mapCanvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const BIOME_COLORS: Record<string, string> = {
  forest: "#166534",
  marsh: "#1e3a5f",
  plains: "#713f12",
  coast: "#1e40af",
  mountains: "#4a3728",
  settlement: "#4c1d95",
};

function resizeCanvas(): void {
  const container = canvas.parentElement!;
  canvas.width = container.clientWidth * devicePixelRatio;
  canvas.height = container.clientHeight * devicePixelRatio;
  canvas.style.width = `${container.clientWidth}px`;
  canvas.style.height = `${container.clientHeight}px`;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}

function getRegionPositions(w: number, h: number): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const cx = w / 2;
  const cy = h / 2;
  const rx = w * 0.32;
  const ry = h * 0.36;
  for (let i = 0; i < regions.length; i++) {
    const angle = (2 * Math.PI * i) / regions.length - Math.PI / 2;
    positions.set(regions[i]!.id, {
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
    });
  }
  return positions;
}

function drawMap(): void {
  const w = canvas.width / devicePixelRatio;
  const h = canvas.height / devicePixelRatio;
  ctx.clearRect(0, 0, w, h);

  const positions = getRegionPositions(w, h);
  const nodeRadius = Math.min(w, h) * 0.08;

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#243049";
  for (const region of regions) {
    const from = positions.get(region.id)!;
    for (const connId of region.connections) {
      const to = positions.get(connId);
      if (to && region.id < connId) {
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }
    }
  }

  for (const region of regions) {
    const pos = positions.get(region.id)!;
    const baseColor = BIOME_COLORS[region.biome] ?? "#333";
    let overlayAlpha = 0;

  if (currentOverlay === "pollution") {
    const tp = region.pollution.air + region.pollution.water + region.pollution.ground;
    overlayAlpha = Math.min(0.7, tp / 40);
  } else if (currentOverlay === "fertility") {
    overlayAlpha = Math.min(0.7, (100 - region.fertility) / 100);
  } else if (currentOverlay === "species") {
    const totalSpecies = region.species.plants + region.species.herbivores + region.species.predators + region.species.fish + region.species.insects;
    overlayAlpha = Math.min(0.7, Math.max(0, (200 - totalSpecies)) / 200);
  }

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, nodeRadius, 0, Math.PI * 2);
    ctx.fillStyle = baseColor;
    ctx.fill();
    if (overlayAlpha > 0) {
      ctx.fillStyle = currentOverlay === "pollution"
        ? `rgba(239,68,68,${overlayAlpha})`
        : currentOverlay === "fertility"
          ? `rgba(234,179,8,${overlayAlpha})`
          : `rgba(168,85,247,${overlayAlpha})`;
      ctx.fill();
    }
    ctx.strokeStyle = "#4a5568";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#d0d8e8";
    ctx.font = "11px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(region.name, pos.x, pos.y + nodeRadius + 14);

    ctx.font = "9px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#6b7fa3";
      if (currentOverlay === "pollution") {
        const tp = region.pollution.air + region.pollution.water + region.pollution.ground;
        ctx.fillText(`A:${region.pollution.air.toFixed(1)} W:${region.pollution.water.toFixed(1)} G:${region.pollution.ground.toFixed(1)}`, pos.x, pos.y + nodeRadius + 26);
      } else if (currentOverlay === "fertility") {
        ctx.fillText(`F:${region.fertility.toFixed(0)} Soil:${region.soilDepth.toFixed(0)}`, pos.x, pos.y + nodeRadius + 26);
      } else if (currentOverlay === "species") {
        const total = region.species.plants + region.species.herbivores + region.species.predators + region.species.fish + region.species.insects;
        ctx.fillText(`P:${region.species.plants} H:${region.species.herbivores} R:${region.species.predators}`, pos.x, pos.y + nodeRadius + 26);
      }

    if (currentOverlay === "citizens") {
      const regionCitizens = citizens.filter(c => c.regionId === region.id && c.alive);
      if (regionCitizens.length > 0) {
        ctx.fillStyle = "#22c55e";
        ctx.font = "10px 'JetBrains Mono', monospace";
        ctx.fillText(`${regionCitizens.length}`, pos.x, pos.y - nodeRadius - 6);
      }
    }
  }

  if (summary) {
    ctx.fillStyle = "#6b7fa3";
    ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    ctx.fillText(`Day ${summary.day}/30 | Footprint: ${summary.globalFootprint.toFixed(1)} | ${summary.result} | Season ${summary.seasonNumber}`, 12, h - 12);

    if (summary.intermission) {
      ctx.fillStyle = "#fbbf24";
      ctx.font = "14px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("INTERMISSION — New season starting soon", w / 2, 20);
    }
  }
}

function updateDashboards(): void {
  if (!summary) return;

  document.getElementById("dayCount")!.textContent = String(summary.day);
  document.getElementById("countdown")!.textContent = `${30 - summary.day} days remaining`;
  document.getElementById("footprint")!.textContent = summary.globalFootprint.toFixed(1);
  document.getElementById("aliveCount")!.textContent = String(summary.aliveCitizens);
  document.getElementById("resultStatus")!.textContent = summary.result;

  const resultEl = document.getElementById("resultStatus")!;
  resultEl.className = "value";
  if (summary.result === "win") resultEl.style.color = "var(--green)";
  else if (summary.result !== "ongoing") resultEl.style.color = "var(--red)";
  else resultEl.style.color = "";

  document.getElementById("coordinator")!.textContent = summary.coordinatorId ?? "None";
  document.getElementById("lawCount")!.textContent = String(summary.lawsEnacted);

  const ecologyEl = document.getElementById("ecologyMetrics")!;
  if (summary.regionSummaries && summary.regionSummaries.length > 0) {
    const totalAir = summary.regionSummaries.reduce((s: number, r: RegionSummary) => s + r.pollution.air, 0);
    const totalWater = summary.regionSummaries.reduce((s: number, r: RegionSummary) => s + r.pollution.water, 0);
    const totalGround = summary.regionSummaries.reduce((s: number, r: RegionSummary) => s + r.pollution.ground, 0);
    const avgFertility = summary.regionSummaries.reduce((s: number, r: RegionSummary) => s + r.fertility, 0) / summary.regionSummaries.length;
    const totalSpecies = summary.regionSummaries.reduce((s: number, r: RegionSummary) => s + r.species.plants + r.species.herbivores + r.species.predators + r.species.fish + r.species.insects, 0);
    ecologyEl.innerHTML = `
      <div class="metric-row"><span class="label">Air Pollution</span><span class="value" style="color:${totalAir > 30 ? "var(--red)" : totalAir > 15 ? "var(--yellow)" : "var(--green)"}">${totalAir.toFixed(1)}</span></div>
      <div class="metric-row"><span class="label">Water Pollution</span><span class="value" style="color:${totalWater > 30 ? "var(--red)" : totalWater > 15 ? "var(--yellow)" : "var(--green)"}">${totalWater.toFixed(1)}</span></div>
      <div class="metric-row"><span class="label">Ground Pollution</span><span class="value" style="color:${totalGround > 30 ? "var(--red)" : totalGround > 15 ? "var(--yellow)" : "var(--green)"}">${totalGround.toFixed(1)}</span></div>
      <div class="metric-row"><span class="label">Avg Fertility</span><span class="value">${avgFertility.toFixed(0)}%</span></div>
      <div class="metric-row"><span class="label">Total Species</span><span class="value" style="color:${totalSpecies < 200 ? "var(--red)" : "var(--green)"}">${totalSpecies}</span></div>
    `;
  }

  const regionList = document.getElementById("regionList")!;
  regionList.innerHTML = "";
  for (const r of regions) {
    const div = document.createElement("div");
    div.className = "region-item";
    div.innerHTML = `<span class="name">${r.name}</span> <span style="color:var(--text-dim)">(${r.biome})</span><div class="stats">Fert:${r.fertility.toFixed(0)} Soil:${r.soilDepth.toFixed(0)} A:${r.pollution.air.toFixed(1)} W:${r.pollution.water.toFixed(1)} G:${r.pollution.ground.toFixed(1)}</div>`;
    regionList.appendChild(div);
  }

  const projectStatusEl = document.getElementById("projectStatus")!;
  const projectStagesEl = document.getElementById("projectStages")!;
  const projectDetailEl = document.getElementById("projectDetail")!;
  if (projectStages.length > 0) {
    const currentIdx = summary.projectStage ?? 0;
    const currentStage = projectStages[currentIdx];
    projectStatusEl.innerHTML = `<span class="label">Stage</span><span class="value">${projectCompleted ? "COMPLETE" : currentStage ? `${currentIdx + 1}/${projectStages.length}: ${currentStage.name}` : "—"}</span>`;
    projectStagesEl.innerHTML = projectStages.map((s, i) => {
      const pct = s.completed ? 100 : i === currentIdx ? computeStagePercent(s) : 0;
      return `<div class="project-stage${s.completed ? " completed" : ""}" title="${s.name}"><div class="fill" style="width:${pct}%"></div></div>`;
    }).join("");
    if (currentStage && !projectCompleted) {
      const resRows = Object.entries(currentStage.requiredResources)
        .filter(([, req]) => req > 0)
        .map(([res, req]) => {
          const got = currentStage.contributedResources[res] ?? 0;
          const done = got >= req;
          return `<div class="project-resource-row"><span class="res-name">${res}</span><span class="res-val" style="color:${done ? "var(--green)" : ""}">${got}/${req}</span></div>`;
        }).join("");
      const labReq = currentStage.requiredLabor;
      const labGot = currentStage.contributedLabor;
      const labPct = Math.min(100, (labGot / labReq) * 100);
      projectDetailEl.innerHTML = `<div class="project-stage-label">${currentStage.name}</div>${resRows}<div class="project-resource-row"><span class="res-name">labor</span><span class="res-val" style="color:${labGot >= labReq ? "var(--green)" : ""}">${labGot.toFixed(1)}/${labReq}</span></div><div class="project-labor-bar"><div class="fill" style="width:${labPct}%"></div></div>`;
    } else if (projectCompleted) {
      projectDetailEl.innerHTML = '<div class="project-stage-label" style="color:var(--green)">Project Complete!</div>';
    } else {
      projectDetailEl.innerHTML = "";
    }
  }

  const citizenList = document.getElementById("citizenList")!;
  citizenList.innerHTML = "";
  const sortedCitizens = [...citizens].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const c of sortedCitizens) {
    const profile = profiles.find(p => p.id === c.id);
    const tags: string[] = [];
    if (!c.alive) tags.push("DEAD");
    if (c.isBot) tags.push("BOT");
    if (profile?.modelTag) tags.push(profile.modelTag);
    const regionName = regions.find(r => r.id === c.regionId)?.name ?? c.regionId;
    const div = document.createElement("div");
    div.className = "citizen-item";
    div.dataset.citizenId = c.id;
    div.innerHTML = `<span class="name" style="cursor:pointer">${c.name}</span><span class="tag${c.isBot ? " bot" : ""}${!c.alive ? " dead" : ""}">${tags.length > 0 ? tags.join(" · ") : regionName}</span>`;
    citizenList.appendChild(div);
  }
  citizenList.querySelectorAll(".citizen-item").forEach(el => {
    el.addEventListener("click", () => {
      const cid = (el as HTMLElement).dataset.citizenId;
      if (cid) showCitizenDetail(cid);
    });
  });

  const eventLog = document.getElementById("eventLog")!;
  const last30 = recentEvents.slice(-30);
  eventLog.innerHTML = last30.map(e =>
    `<div class="event-line"><span class="day">[D${e.day}]</span> ${formatEvent(e)}</div>`
  ).join("");
  eventLog.scrollTop = eventLog.scrollHeight;

  const lawListEl = document.getElementById("lawList")!;
  lawListEl.innerHTML = laws.length === 0
    ? '<div style="color:var(--text-dim);font-size:11px;padding:4px 0">No laws enacted yet</div>'
    : laws.map(l => {
      const params = Object.entries({ ...l.parameters, ...l.stringParams }).map(([k, v]) => `${k}=${v}`).join(", ");
      return `<div class="law-item"><span class="title">${l.title}</span> <span class="cat">[${l.category}] D${l.enactedDay}</span>${params ? `<div class="params">${params}</div>` : ""}</div>`;
    }).join("");

  const marketListEl = document.getElementById("marketList")!;
  marketListEl.innerHTML = marketListings.length === 0
    ? '<div style="color:var(--text-dim);font-size:11px;padding:4px 0">No listings</div>'
    : marketListings.map(m => {
      const sellerName = citizens.find(c => c.id === m.sellerId)?.name ?? m.sellerId;
      return `<div class="market-item"><span class="resource">${m.quantity} ${m.resourceType}</span><span class="price">${m.pricePerUnit}cr/ea</span><span class="seller">${sellerName}</span></div>`;
    }).join("");

  const archiveListEl = document.getElementById("archiveList")!;
  archiveListEl.innerHTML = archives.length === 0
    ? '<div style="color:var(--text-dim);font-size:11px;padding:4px 0">No archived seasons</div>'
    : archives.map((a, i) => {
      const resultClass = a.result === "win" ? "win" : a.result === "lose_deadline" ? "lose_deadline" : "lose_collapse";
      const date = new Date(a.archived_at).toLocaleDateString();
      return `<div class="archive-item" data-archive-idx="${i}"><span class="season-label">Season ${archives.length - i}</span><span class="result ${resultClass}">${a.result} D${a.day}</span><span style="color:var(--text-dim);font-size:10px">${date}</span></div>`;
    }).join("");
  archiveListEl.querySelectorAll(".archive-item").forEach(el => {
    el.addEventListener("click", () => {
      const idx = Number((el as HTMLElement).dataset.archiveIdx);
      const archive = archives[idx];
      if (archive) showArchiveDetail(archive.season_id, archives.length - idx);
    });
  });

  const metricsPanel = document.getElementById("metricsPanel")!;
  const metricsContent = document.getElementById("metricsContent")!;
  if (summary && summary.result !== "ongoing") {
    metricsPanel.style.display = "";
    fetch(`${API_BASE}/api/metrics`).then(r => r.json()).then((m: SeasonMetricsData) => {
      metricsContent.innerHTML = renderMetrics(m);
    }).catch(() => { metricsPanel.style.display = "none"; });
  } else {
    metricsPanel.style.display = "none";
  }
}

async function showArchiveDetail(seasonId: string, seasonNum: number): Promise<void> {
  const el = document.getElementById("archiveDetail")!;
  el.style.display = "flex";
  el.innerHTML = `<h2>Season ${seasonNum}</h2><p>Loading...</p><button class="close-btn" id="closeArchive">Close</button>`;
  document.getElementById("closeArchive")!.addEventListener("click", () => { el.style.display = "none"; });

  try {
    const res = await fetch(`${API_BASE}/api/archives/${seasonId}`);
    if (!res.ok) throw new Error("Not found");
    const data = (await res.json()) as ArchiveDetail;
    const resultClass = data.result === "win" ? "color:var(--green)" : data.result === "lose_deadline" ? "color:var(--red)" : "color:var(--orange)";

    let metricsHtml = "";
    try {
      const mRes = await fetch(`${API_BASE}/api/archives/${seasonId}/metrics`);
      if (mRes.ok) {
        const metrics = (await mRes.json()) as SeasonMetricsData;
        metricsHtml = renderMetrics(metrics);
      }
    } catch { /* metrics optional */ }

    el.innerHTML = `
      <button class="close-btn" id="closeArchive">Close</button>
      <h2 style="${resultClass}">Season ${data.seasonNumber}</h2>
      <p>Day ${data.day}/30 — <span style="${resultClass}">${data.result}</span></p>
      <p>Footprint: ${data.globalFootprint.toFixed(1)} | Alive: ${data.aliveCitizens}/${data.totalCitizens} | Laws: ${data.lawsEnacted} | Treasury: ${data.treasury}cr</p>
      ${metricsHtml}
      ${data.citizenProfiles.length > 0 ? `<div style="margin-top:12px;font-size:12px;color:var(--text-dim)">${data.citizenProfiles.map(p => `<span>${p.name}${p.isBot ? " (BOT)" : ""}${p.modelTag ? ` [${p.modelTag}]` : ""} S${p.seasonsPlayed}W${p.seasonsWon}R${p.reputation}</span>`).join(" · ")}</div>` : ""}
      ${data.timeline.length > 0 ? `<div class="timeline-chart" style="margin-top:16px"><canvas id="archiveTimelineCanvas"></canvas></div>
      <div class="timeline-legend">
        <span><span class="dot" style="background:#ef4444"></span> Footprint</span>
        <span><span class="dot" style="background:#f97316"></span> Temperature</span>
        <span><span class="dot" style="background:#22c55e"></span> Species</span>
        <span><span class="dot" style="background:#3b82f6"></span> Alive</span>
      </div>` : ""}
    `;
    document.getElementById("closeArchive")!.addEventListener("click", () => { el.style.display = "none"; });
    if (data.timeline.length > 0) drawTimelineChart(data.timeline, "archiveTimelineCanvas");
  } catch {
    el.innerHTML = `<h2>Error</h2><p>Could not load archive</p><button class="close-btn" id="closeArchive">Close</button>`;
    document.getElementById("closeArchive")!.addEventListener("click", () => { el.style.display = "none"; });
  }
}

async function showCitizenDetail(citizenId: string): Promise<void> {
  const el = document.getElementById("citizenDetail")!;
  el.style.display = "flex";
  el.innerHTML = `<h2>Loading...</h2><button class="close-btn" id="closeCitizen">Close</button>`;
  document.getElementById("closeCitizen")!.addEventListener("click", () => { el.style.display = "none"; });

  try {
    const res = await fetch(`${API_BASE}/api/citizens/${citizenId}`);
    if (!res.ok) throw new Error("Not found");
    const d = (await res.json()) as CitizenDetailData;
    const inv = Object.entries(d.inventory).filter(([, v]) => v > 0);
    const skills = Object.entries(d.skills).filter(([, v]) => v > 0);
    const claimsHtml = d.claims.length > 0
      ? d.claims.map(c => `<span class="inv-item">${c.regionName}: ${c.resourceType}</span>`).join("")
      : "None";
    const profileHtml = d.profile
      ? `<div class="stat"><div class="lbl">Seasons</div><div class="val">${d.profile.seasonsPlayed} played / ${d.profile.seasonsWon} won</div></div>
         <div class="stat"><div class="lbl">Reputation</div><div class="val">${d.profile.reputation}</div></div>
         ${d.profile.titles.length > 0 ? `<div class="stat" style="grid-column:1/-1"><div class="lbl">Titles</div><div class="val">${d.profile.titles.join(", ")}</div></div>` : ""}`
      : "";
    const evtHtml = d.recentEvents.length > 0
      ? d.recentEvents.map(e => `<div class="evt">[D${e.day}] ${e.type}: ${JSON.stringify(e.data).slice(0, 80)}</div>`).join("")
      : "No recent events";

    el.innerHTML = `
      <button class="close-btn" id="closeCitizen">Close</button>
      <h2>${d.name}${d.isBot ? " <span style='color:var(--yellow);font-size:16px'>(BOT)</span>" : ""}${d.modelTag ? ` <span style='color:var(--accent);font-size:14px'>[${d.modelTag}]</span>` : ""}</h2>
      <p style="color:${d.alive ? "var(--green)" : "var(--red)"};font-size:14px">${d.alive ? "Alive" : "Dead"} — ${d.regionName}${d.office ? ` (${d.office})` : ""}</p>
      <div class="citizen-detail-grid">
        <div class="stat"><div class="lbl">Health</div><div class="val">${d.health}hp</div></div>
        <div class="stat"><div class="lbl">Hunger</div><div class="val">${d.hunger}</div></div>
        <div class="stat"><div class="lbl">Credits</div><div class="val">${d.credits}cr</div></div>
        <div class="stat"><div class="lbl">Claims</div><div class="val">${d.claims.length}</div></div>
        ${profileHtml}
      </div>
      <div class="citizen-inventory" style="margin-top:8px">
        <div style="color:var(--text-dim);font-size:10px;margin-bottom:4px">INVENTORY</div>
        ${inv.length > 0 ? inv.map(([k, v]) => `<span class="inv-item">${v} ${k}</span>`).join("") : "<span style='color:var(--text-dim)'>Empty</span>"}
      </div>
      ${skills.length > 0 ? `<div class="citizen-inventory"><div style="color:var(--text-dim);font-size:10px;margin-bottom:4px">SKILLS</div>${skills.map(([k, v]) => `<span class="inv-item">${k}: ${v}</span>`).join("")}</div>` : ""}
      <div class="citizen-inventory"><div style="color:var(--text-dim);font-size:10px;margin-bottom:4px">CLAIMS</div>${claimsHtml}</div>
      <div class="citizen-events"><div style="color:var(--text-dim);font-size:10px;margin-bottom:4px">RECENT ACTIVITY</div>${evtHtml}</div>
    `;
    document.getElementById("closeCitizen")!.addEventListener("click", () => { el.style.display = "none"; });
  } catch {
    el.innerHTML = `<h2>Error</h2><p>Could not load citizen</p><button class="close-btn" id="closeCitizen">Close</button>`;
    document.getElementById("closeCitizen")!.addEventListener("click", () => { el.style.display = "none"; });
  }
}

function renderMetrics(m: SeasonMetricsData): string {
  const modelRows = Object.entries(m.perModel).map(([tag, d]) =>
    `<tr><td>${tag}</td><td>${d.count}</td><td>${(d.survivalRate * 100).toFixed(0)}%</td><td>${d.avgReputation.toFixed(1)}</td><td>${(d.contributionRate * 100).toFixed(0)}%</td></tr>`
  ).join("");
  return `
    <div class="metrics-grid" style="margin-top:16px">
      <div class="metric"><div class="val">${(m.giniCoefficient * 100).toFixed(1)}%</div><div class="lbl">Gini (inequality)</div></div>
      <div class="metric"><div class="val">${m.cooperationScore.toFixed(2)}</div><div class="lbl">Cooperation</div></div>
      <div class="metric"><div class="val">${m.governanceScore.toFixed(2)}</div><div class="lbl">Governance</div></div>
      <div class="metric"><div class="val">${(m.survivalRate * 100).toFixed(0)}%</div><div class="lbl">Survival</div></div>
    </div>
    ${modelRows ? `<table class="model-table"><tr><th>Model</th><th>#</th><th>Surv</th><th>Rep</th><th>Contrib%</th></tr>${modelRows}</table>` : ""}
  `;
}

function formatEvent(e: { type: string; data: Record<string, unknown> }): string {
  const d = e.data;
  switch (e.type) {
    case "tick": return "";
    case "citizen_registered": return `${d.name} registered in ${d.regionId}`;
    case "travel": return `${d.citizenId} traveled to ${d.to}`;
    case "gather": return `${d.citizenId} gathered ${d.amount} ${d.resourceType}`;
    case "craft": return `${d.citizenId} crafted ${d.outputAmount} ${d.outputType}`;
    case "contribute": return `${d.citizenId} contributed to project`;
    case "propose": return `${d.citizenId} proposed: ${d.title}`;
    case "vote": return `${d.citizenId} voted on ${d.proposalId}`;
    case "vote_resolution": return `Proposal ${d.proposalId} ${d.result}`;
    case "say": return `${d.citizenName ?? d.citizenId}: ${d.message}`;
    case "citizen_died": return `${d.citizenId} died (${d.cause})`;
    case "project_stage_completed": return `Project stage completed: ${d.stageName}`;
    case "project_completed": return "COLLECTIVE PROJECT COMPLETED!";
    case "season_end": return `Season ended: ${d.result}`;
    default: return `${e.type}: ${JSON.stringify(d).slice(0, 80)}`;
  }
}

function showSeasonResult(result: string): void {
  const el = document.getElementById("seasonResult")!;
  if (result === "ongoing") {
    el.style.display = "none";
    return;
  }
  el.style.display = "flex";
  el.className = `season-result ${result}`;
  const titles: Record<string, string> = { win: "COLONY SURVIVED", lose_deadline: "DEADLINE MISSED", lose_collapse: "ECOLOGICAL COLLAPSE" };
  const timeline = summary?.timeline ?? [];
  el.innerHTML = `
    <h2>${titles[result] ?? result}</h2>
    <p>Day ${summary?.day ?? "?"} — Season ${summary?.seasonNumber ?? "?"}</p>
    <div class="timeline-chart"><canvas id="timelineCanvas"></canvas></div>
    <div class="timeline-legend">
      <span><span class="dot" style="background:#ef4444"></span> Footprint</span>
      <span><span class="dot" style="background:#f97316"></span> Temperature</span>
      <span><span class="dot" style="background:#22c55e"></span> Species</span>
      <span><span class="dot" style="background:#3b82f6"></span> Alive</span>
    </div>
  `;
  drawTimelineChart(timeline, "timelineCanvas");
}

function drawTimelineChart(timeline: TimelineSnapshot[], canvasId = "timelineCanvas"): void {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
  if (!canvas || timeline.length === 0) return;
  const dpr = devicePixelRatio;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const c = canvas.getContext("2d")!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);

  const maxFootprint = Math.max(...timeline.map(t => t.globalFootprint), 1);
  const maxTemp = Math.max(...timeline.map(t => t.globalTemperature), 1);
  const maxSpecies = Math.max(...timeline.map(t => t.totalSpecies), 1);
  const maxAlive = Math.max(...timeline.map(t => t.aliveCitizens), 1);
  const lastDay = timeline[timeline.length - 1]!.day || 1;

  const lines: Array<{ data: number[]; color: string; max: number }> = [
    { data: timeline.map(t => t.globalFootprint), color: "#ef4444", max: maxFootprint },
    { data: timeline.map(t => t.globalTemperature), color: "#f97316", max: maxTemp },
    { data: timeline.map(t => t.totalSpecies), color: "#22c55e", max: maxSpecies },
    { data: timeline.map(t => t.aliveCitizens), color: "#3b82f6", max: maxAlive },
  ];

  const pad = 4;
  for (const line of lines) {
    c.beginPath();
    c.strokeStyle = line.color;
    c.lineWidth = 1.5;
    for (let i = 0; i < line.data.length; i++) {
      const x = pad + (i / (lastDay - 1 || 1)) * (w - pad * 2);
      const y = h - pad - (line.data[i]! / line.max) * (h - pad * 2);
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
  }

  c.fillStyle = "#6b7fa3";
  c.font = "9px 'JetBrains Mono', monospace";
  c.textAlign = "left";
  c.fillText(`Day 1`, pad, h - 1);
  c.textAlign = "right";
  c.fillText(`Day ${lastDay}`, w - pad, h - 1);
}

async function fetchState(): Promise<void> {
  try {
    const [stateRes, regionsRes, citizensRes, eventsRes, lawsRes, marketRes, archivesRes, projectRes] = await Promise.all([
      fetch(`${API_BASE}/api/state`),
      fetch(`${API_BASE}/api/regions`),
      fetch(`${API_BASE}/api/citizens`),
      fetch(`${API_BASE}/api/events?since=0`),
      fetch(`${API_BASE}/api/laws`),
      fetch(`${API_BASE}/api/market`),
      fetch(`${API_BASE}/api/archives`),
      fetch(`${API_BASE}/api/project`),
    ]);
    summary = await stateRes.json();
    regions = await regionsRes.json();
    const citizensData = await citizensRes.json();
    if (Array.isArray(citizensData)) {
      citizens = citizensData;
      profiles = [];
    } else {
      citizens = (citizensData as { citizens: CitizenSummary[]; profiles: CitizenProfile[] }).citizens ?? [];
      profiles = (citizensData as { citizens: CitizenSummary[]; profiles: CitizenProfile[] }).profiles ?? [];
    }
    recentEvents = await eventsRes.json();
    laws = await lawsRes.json();
    const marketData = await marketRes.json();
    marketListings = (marketData.listings ?? []) as MarketListing[];
    archives = await archivesRes.json();
    const projectData = await projectRes.json();
    projectStages = projectData.stages ?? [];
    projectCompleted = projectData.completed ?? false;
    updateDashboards();
    drawMap();
    drawLiveTimeline();
  } catch (err) {
    console.error("Failed to fetch state:", err);
  }
}

function connectWebSocket(): void {
  const ws = new WebSocket(WS_URL);
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string) as Record<string, unknown>;
      if (msg.type === "season_end" || msg.type === "intermission" || msg.type === "intermission_ended") {
        fetchState();
      }
      if (msg.type === "season_end") {
        showSeasonResult(msg.result as string);
      }
      if (msg.type === "intermission") {
        const el = document.getElementById("seasonResult")!;
        el.style.display = "flex";
        el.className = "season-result ongoing";
        el.innerHTML = `<h2>INTERMISSION</h2><p>Season ${msg.seasonNumber} starting soon...</p>`;
      }
    } catch { /* ignore */ }
  };
  ws.onclose = () => {
    setTimeout(connectWebSocket, 3000);
  };
}

function setupOverlayToggles(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>(".map-overlay-toggles button");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      buttons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentOverlay = btn.dataset.overlay as OverlayType;
      drawMap();
    });
  });
}

function drawLiveTimeline(): void {
  if (!summary) return;
  const timeline = summary.timeline ?? [];
  const canvas = document.getElementById("liveTimelineCanvas") as HTMLCanvasElement | null;
  if (!canvas || timeline.length === 0) return;
  const dpr = devicePixelRatio;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const c = canvas.getContext("2d")!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);

  const maxFootprint = Math.max(...timeline.map(t => t.globalFootprint), 1);
  const maxTemp = Math.max(...timeline.map(t => t.globalTemperature), 1);
  const maxSpecies = Math.max(...timeline.map(t => t.totalSpecies), 1);
  const maxAlive = Math.max(...timeline.map(t => t.aliveCitizens), 1);
  const lastDay = timeline[timeline.length - 1]!.day || 1;

  const lines: Array<{ data: number[]; color: string; max: number }> = [
    { data: timeline.map(t => t.globalFootprint), color: "#ef4444", max: maxFootprint },
    { data: timeline.map(t => t.globalTemperature), color: "#f97316", max: maxTemp },
    { data: timeline.map(t => t.totalSpecies), color: "#22c55e", max: maxSpecies },
    { data: timeline.map(t => t.aliveCitizens), color: "#3b82f6", max: maxAlive },
  ];

  const pad = 2;
  for (const line of lines) {
    c.beginPath();
    c.strokeStyle = line.color;
    c.lineWidth = 1;
    c.globalAlpha = 0.7;
    for (let i = 0; i < line.data.length; i++) {
      const x = pad + (i / (lastDay - 1 || 1)) * (w - pad * 2);
      const y = h - pad - (line.data[i]! / line.max) * (h - pad * 2);
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
    c.globalAlpha = 1;
  }
}

function setupPlaybackControls(): void {
  const btnPause = document.getElementById("btnPause")!;
  const btnSlow = document.getElementById("btnSpeedSlow")!;
  const btnFast = document.getElementById("btnSpeedFast")!;

  btnPause.addEventListener("click", () => {
    refreshPaused = !refreshPaused;
    btnPause.textContent = refreshPaused ? "Resume" : "Pause";
    restartRefreshTimer();
  });
  btnSlow.addEventListener("click", () => {
    refreshIntervalMs = Math.min(60000, refreshIntervalMs * 2);
    restartRefreshTimer();
  });
  btnFast.addEventListener("click", () => {
    refreshIntervalMs = Math.max(2000, Math.floor(refreshIntervalMs / 2));
    restartRefreshTimer();
  });
}

function restartRefreshTimer(): void {
  if (refreshTimer) clearInterval(refreshTimer);
  if (!refreshPaused) {
    refreshTimer = setInterval(() => { if (!refreshPaused) fetchState(); }, refreshIntervalMs);
  }
}

function computeStagePercent(s: ProjectStageSummary): number {
  const resEntries = Object.entries(s.requiredResources).filter(([, v]) => v > 0);
  let resPct = 0;
  if (resEntries.length > 0) {
    resPct = resEntries.reduce((acc, [k, req]) => acc + Math.min(1, (s.contributedResources[k] ?? 0) / req), 0) / resEntries.length;
  }
  const labPct = s.requiredLabor > 0 ? Math.min(1, s.contributedLabor / s.requiredLabor) : 1;
  return Math.round((resPct + labPct) / 2 * 100);
}

function main(): void {
  resizeCanvas();
  window.addEventListener("resize", () => { resizeCanvas(); drawMap(); });
  setupOverlayToggles();
  setupPlaybackControls();
  fetchState();
  connectWebSocket();
  restartRefreshTimer();
}

main();
