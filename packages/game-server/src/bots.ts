import {
  type SeasonState, type CitizenId, registerCitizen,
  travel, gather, craft, contribute, say,
  makeCitizenId, makeRegionId,
  propose, vote, campaign, startElection, closeElection, voteInElection,
  govern,
} from "@ecomolt/simulation-core";
import type { ResourceType } from "@ecomolt/shared";
import { totalPollution } from "@ecomolt/shared";
import type { LawCategory } from "@ecomolt/simulation-core";

export interface BotConfig {
  count: number;
  tickActionChance: number;
  contributeChance: number;
  travelChance: number;
  speakChance: number;
  voteChance: number;
  campaignChance: number;
  crisisProposeChance: number;
}

export const DEFAULT_BOT_CONFIG: BotConfig = {
  count: 8,
  tickActionChance: 0.7,
  contributeChance: 0.5,
  travelChance: 0.1,
  speakChance: 0.05,
  voteChance: 0.6,
  campaignChance: 0.05,
  crisisProposeChance: 0.3,
};

const BOT_NAMES = ["Alder", "Birch", "Cedar", "Dune", "Elm", "Fern", "Grove", "Hazel", "Ivy", "Juniper", "Kelp", "Lichen", "Moss", "Nettle", "Oak", "Pine", "Quill", "Reed", "Sage", "Thorn", "Aspen", "Briar", "Clover", "Drift", "Ember", "Frost", "Glade", "Hawk", "Iris", "Jade", "Knoll", "Lark", "Mint", "Nova", "Opal", "Petal", "Quake", "Ridge", "Storm", "Vale"];

export function registerBots(state: SeasonState, config: BotConfig): CitizenId[] {
  const ids: CitizenId[] = [];
  for (let i = 0; i < config.count; i++) {
    const name = BOT_NAMES[i % BOT_NAMES.length] ?? `Bot${i}`;
    const id = makeCitizenId(`bot-${name.toLowerCase()}`);
    if (!state.citizens.has(id)) {
      registerCitizen(state, id, name, true, null);
    }
    ids.push(id);
  }
  return ids;
}

export function runBotTick(state: SeasonState, botIds: CitizenId[], config: BotConfig): void {
  for (const botId of botIds) {
    const citizen = state.citizens.get(botId);
    if (!citizen || !citizen.alive) continue;
    if (Math.random() > config.tickActionChance) continue;

    const idx = botIds.indexOf(botId);
    const role = idx % 5;

    if (role === 0) {
      gather(state, botId, "food");
    } else if (role === 1) {
      const region = state.regions.get(citizen.regionId)!;
      gather(state, botId, region.deposits.ore > 5 ? "ore" : "wood");
    } else if (role === 2) {
      gather(state, botId, "wood");
    } else if (role === 3) {
      if (citizen.inventory.ore >= 3) {
        craft(state, botId, "refined_ore");
      } else if (citizen.inventory.ore >= 1 && citizen.inventory.wood >= 1) {
        craft(state, botId, "processed_energy");
      } else {
        gather(state, botId, "energy");
      }
    } else {
      gather(state, botId, "energy");
    }

    if (Math.random() < config.contributeChance) {
      const bestRes = (["ore", "energy", "wood", "food"] as ResourceType[]).find(r => (citizen.inventory[r] ?? 0) >= 5);
      if (bestRes) {
        contribute(state, botId, bestRes, Math.min(citizen.inventory[bestRes] ?? 0, 8), 2);
      }
    }

    if (Math.random() < config.travelChance) {
      const region = state.regions.get(citizen.regionId)!;
      if (region.connections.length > 0) {
        const dest = region.connections[Math.floor(Math.random() * region.connections.length)]!;
        travel(state, botId, makeRegionId(dest));
      }
    }

    if (Math.random() < config.speakChance) {
      const messages = [
        "We need to contribute more to the project.",
        "The pollution is getting bad in my region.",
        "I think we should propose an emission cap.",
        "Has anyone started on the defense systems yet?",
        "We're running low on ore deposits.",
        "Food supplies look stable for now.",
        "We should elect a coordinator.",
        "The deadline is approaching.",
        "We need an ecology steward to manage this crisis.",
        "If I'm elected, I'll push for extraction limits.",
        "I've been gathering resources all day.",
        "Let's focus on the collective project.",
        "Someone should claim the ore deposits before they're depleted.",
        "Trade is looking good on the market right now.",
        "We need more refined materials for the project.",
      ];
      const msg = messages[Math.floor(Math.random() * messages.length)]!;
      say(state, botId, "global", msg);
    }

  const region = state.regions.get(citizen.regionId)!;
  const totalPoll = totalPollution(region.pollution);
  const worstPollType = region.pollution.air >= region.pollution.water && region.pollution.air >= region.pollution.ground ? "air"
    : region.pollution.water >= region.pollution.ground ? "water" : "ground";
  if (totalPoll > 15 && Math.random() < config.crisisProposeChance) {
    const hasExistingCap = state.laws.some(l => l.parameters["emissionCap"] !== undefined);
    if (!hasExistingCap) {
      propose(
        state, botId,
        `Emergency ${worstPollType === "air" ? "Emission" : worstPollType === "water" ? "Water" : "Ground"} Cap for ${region.name}`,
        `Pollution in ${region.name} has reached critical levels (${worstPollType}: ${region.pollution[worstPollType].toFixed(1)}). We need a cap.`,
        "environmental" as LawCategory,
        { emissionCap: 10, enforcementFine: 8 },
        { targetRegion: region.id, pollutionType: worstPollType },
      );
    }
  }

    const activeProposals = [...state.proposals.values()].filter(p => p.status === "active");
    if (activeProposals.length > 0 && Math.random() < config.voteChance) {
      for (const proposal of activeProposals) {
        if (proposal.votesFor.has(botId) || proposal.votesAgainst.has(botId)) continue;
        let support = Math.random() > 0.4;
        if (proposal.category === "environmental" && totalPoll > 10) support = true;
        if (proposal.category === "economic" && citizen.credits < 20) support = Math.random() > 0.6;
        if (proposal.category === "resource" && citizen.inventory.food < 5) support = false;
        vote(state, botId, proposal.id, support);
        break;
      }
    }

    if (state.electionActive && Math.random() < config.campaignChance) {
      const isCandidate = state.electionCandidates.includes(botId);
      if (!isCandidate && state.electionCandidates.length < 3) {
        const platforms: Record<string, string> = {
          coordinator: "I will manage the treasury responsibly and fund public goods.",
          ecology_steward: "I will use emergency powers to cap pollution in critical regions.",
          project_director: "I will prioritize the resources we need most and call levies if necessary.",
        };
        campaign(state, botId, platforms[state.electionOffice] ?? "I will serve the colony faithfully.");
      }
    }

    if (state.electionActive && state.electionCandidates.length > 0 && Math.random() < config.voteChance) {
      const hasVoted = state.electionVotes.has(botId);
      if (!hasVoted) {
        const candidate = scoreCandidates(state, botId, citizen);
        if (candidate) {
          voteInElection(state, botId, candidate);
        }
      }
    }
  }
}

function scoreCandidates(state: SeasonState, voterId: CitizenId, voter: { credits: number; inventory: { food: number }; regionId: string }): CitizenId | null {
  const candidates = state.electionCandidates;
  if (candidates.length === 0) return null;

  const region = state.regions.get(voter.regionId as ReturnType<typeof makeRegionId>)!;
  const totalPoll = region ? totalPollution(region.pollution) : 0;
  const isPoor = voter.credits < 20 || voter.inventory.food < 5;
  const isPolluted = totalPoll > 10;

  let bestCandidate = candidates[0]!;
  let bestScore = -Infinity;

  for (const candId of candidates) {
    let score = 0;
    const platform = state.campaignPlatforms.get(candId) ?? "";
    const platLower = platform.toLowerCase();

    if (isPolluted) {
      if (platLower.includes("pollut") || platLower.includes("emission") || platLower.includes("cap") || platLower.includes("ecolog")) score += 3;
      if (platLower.includes("emergency")) score += 2;
    }
    if (isPoor) {
      if (platLower.includes("treasury") || platLower.includes("fund") || platLower.includes("allocat")) score += 2;
      if (platLower.includes("tax") || platLower.includes("levy")) score -= 1;
    }
    if (platLower.includes("project") || platLower.includes("priority") || platLower.includes("contribut")) score += 1;

    if (candId === voterId) score += 5;

    score += Math.random() * 1.5;

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candId;
    }
  }

  return bestCandidate;
}
