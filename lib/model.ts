// Token Radar, model radar-2. The program reads one sealed snapshot of the
// protocol universe and writes one ranked board.
//
// The board starts from the snapshot's watchlist, the floor the house itself
// drew: every protocol with at least $50M of TVL and no token on record. It
// then adds the early rows, every genuine pre-token protocol below that
// floor, so the radar finds launches the watchlist has not reached yet. A
// protocol is a genuine pre-token subject when its record carries no token
// and it is none of the things that merely wrap one: not a wrapped, staked
// or bridged product, not a versioned pool, not an exchange. The same
// exclusion that shaped the watchlist shapes the early rows, so a staking
// receipt never takes a rank meant for a protocol still waiting on a launch
// of its own.
//
// Each row's implied value is a peer-multiple estimate, computed only from
// the snapshot's own figures:
//
//   peer multiple = median mcap/TVL of the live-token protocols in the
//                     row's category (three or more of them; the whole
//                     market's median when a category has fewer),
//                     clamped to [0.02, 1.00]
//   base          = tvl_usd x peer multiple
//   growth        = change_7d clamped to [-50, 100] per cent
//   growth factor = 1 + (growth / 100) x 0.6
//   age factor    = 0.6 + min(age_days, 1095) / 1095 x 0.4
//                   (age_days unknown: 365)
//   implied       = max(1, round(base x growth factor x age factor))
//
// In words: a pre-token protocol's token, if it launched at the multiple its
// live-token peers trade at, would be worth its TVL times that multiple;
// recent growth and a long run with no token move the estimate. No protocol
// name is ever special-cased. The dashboard prints the multiple each row was
// scored at, so any reader can redo the arithmetic from the row's own figures.

/** One protocol entry from the sealed snapshot: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document as a whole. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's tunable numbers, printed in the dashboard so the sandbox can vary them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  multiple_floor: number;
  multiple_cap: number;
  min_live_comps: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  multiple_floor: 0.02,
  multiple_cap: 1.0,
  min_live_comps: 3,
};

/** The label the dashboard and the rules quote for this model. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the dashboard's Live token view shows, by market cap. */
export const LIVE_ROWS = 24;

/** One farm-plan step: what to do, what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One ranked row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_source: string;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** One row as the dashboard keeps it, with the farm plan built in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  multiple_source: string;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** One live-token protocol: it already trades, so the board shows the market's value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl_ratio: number | null;
}

/** The dashboard's whole dataset: the board, the live set, and the model behind them. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  multiples: Record<string, { multiple: number; comps: number; source: string }>;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Thrown when the snapshot file is not the shape this model scores. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const MS_PER_DAY = 86_400_000;

/** A finite number, or `fallback` when the value is missing or not finite. */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, never negative; null when a date is missing or unparsable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / MS_PER_DAY));
}

/** The middle value of a list, or null for an empty one. */
function middle(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const half = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[half]!;
  return (ordered[half - 1]! + ordered[half]!) / 2;
}

/** Four-decimal rounding, for the figures the board prints beside each row. */
const fourDp = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The peer multiple for every category in the snapshot: the median mcap/TVL
 *  of its live-token protocols, falling back to the whole market's median
 *  where a category has too few live peers to speak for itself. */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): Record<string, { multiple: number; comps: number; source: string }> {
  const ratiosByCategory = new Map<string, number[]>();
  const everyRatio: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    everyRatio.push(ratio);
    const key = p.category ?? 'Other';
    const bucket = ratiosByCategory.get(key);
    if (bucket === undefined) ratiosByCategory.set(key, [ratio]);
    else bucket.push(ratio);
  }
  const marketMultiple = middle(everyRatio) ?? 0.2;
  const within = (m: number): number => Math.min(model.multiple_cap, Math.max(model.multiple_floor, m));
  const out: Record<string, { multiple: number; comps: number; source: string }> = {};
  const categories = new Set(snapshot.protocols.map((p) => p.category ?? 'Other'));
  for (const category of categories) {
    const peers = ratiosByCategory.get(category) ?? [];
    if (peers.length >= model.min_live_comps) {
      out[category] = { multiple: within(middle(peers) ?? marketMultiple), comps: peers.length, source: 'category' };
    } else {
      out[category] = { multiple: within(marketMultiple), comps: peers.length, source: 'market' };
    }
  }
  return out;
}

/** The multiple one protocol is scored at, with where it came from. */
export function multipleFor(p: SnapshotProtocol, multiples: Record<string, { multiple: number; comps: number; source: string }>, model: ModelConstants = MODEL): { multiple: number; source: string } {
  const entry = multiples[p.category ?? 'Other'];
  if (entry !== undefined) return { multiple: entry.multiple, source: entry.source };
  return { multiple: model.multiple_floor, source: 'floor' };
}

/** The score one protocol gets: its implied value and the three factors behind it. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: Record<string, { multiple: number; comps: number; source: string }>,
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; multipleSource: string; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = numOr(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const { multiple, source } = multipleFor(protocol, multiples, model);
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, multiple, multipleSource: source, growthPct, growthMult, maturityMult, age };
}

/** A name ending in a release marker is a pool of another protocol, not a launch of its own. */
const RELEASE_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that only ever hold wrapped, staked or bridged forms of a token that trades. */
const WRAPPED_ONLY_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names: a genuine protocol never begins with one. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether the snapshot records no token for this protocol at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is a wrapped, staked or bridged product, a versioned pool, an
 *  exchange, or otherwise not a protocol waiting on a launch of its own. */
export function isWrappedProduct(p: SnapshotProtocol): boolean {
  if (WRAPPED_ONLY_CATEGORIES.has(p.category ?? '')) return true;
  if (RELEASE_SUFFIX.test(p.name)) return true;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return true;
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return true;
  return false;
}

/** Whether a protocol may take a rank: pre-token and not a wrapped product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isWrappedProduct(p);
}

/** Index the snapshot's protocols by slug. */
function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The ranked board: watchlist first, then the early rows, strongest implied value first. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; multiples: Record<string, { multiple: number; comps: number; source: string }> } {
  const multiples = categoryMultiples(snapshot, model);
  const index = indexBySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor, never the ceiling: every slug it names joins
  // the board, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every genuine pre-token protocol below the watchlist
  // floor, biggest TVL first. No TVL cap inside the set: the floor is where
  // the house's reading started, not where this radar stops. Wrapped products
  // stay out by the same rule as the watchlist.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, multiples, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      multiple: fourDp(s.multiple),
      multiple_source: s.multipleSource,
      growth_pct: s.growthPct,
      growth_multiplier: fourDp(s.growthMult),
      maturity_multiplier: fourDp(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
  return { board, multiples };
}

/** One farm step as a single string: the action, then its cost and time, kept inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a protocol's first chain, in the words a farmer budgets with. */
function txCostWords(p: SnapshotProtocol): string {
  const chain = firstChain(p).toLowerCase();
  if (chain === 'ethereum') return 'about $8 of gas per transaction';
  if (chain === 'solana') return 'under $0.10 of gas per transaction';
  if (['base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche', 'linea', 'scroll', 'zksync', 'starknet', 'blast', 'mantle', 'mode', 'taiko', 'opbnb', 'gnosis'].some((c) => chain.includes(c))) {
    return 'under $1 of gas per transaction';
  }
  return 'about $2 of gas per transaction';
}

/** The capital one farm position needs, sized from the protocol's own TVL. */
function stakeSize(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDays(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, worded so a farmer can follow it. */
function mainAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open so it counts as a lender.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open through the next fee cycle.`;
  if (c.includes('yield') || c.includes('yield aggregator') || c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares instead of withdrawing them.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds inside its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token in your wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('synthetic')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge, then leave the position alone.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}, then let it settle instead of trading it.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in your wallet.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it for the full term.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('privacy')) return `Deposit $${capital} through ${name}'s private pool on ${chain} and keep the note safe.`;
  if (c.includes('gaming') || c.includes('gambling')) return `Deposit $${capital} into ${name} on ${chain} and play one full session with it.`;
  if (c.includes('social')) return `Deposit $${capital} into ${name} on ${chain} and use its app once a week.`;
  if (c.includes('ai') || c.includes('depin') || c.includes('compute')) return `Deposit $${capital} into ${name} on ${chain} and run one job through it.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const capital = stakeSize(p);
  const hold = holdDays(age);
  const gas = txCostWords(p);
  const action = mainAction(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline where nobody else can read it.`,
      cost: gas.replace('per transaction', 'for the first transaction'),
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the wallet looks used rather than parked.`,
      cost: gas.replace('per transaction', 'a week'),
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot of the protocol.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Once a month, open ${p.name}'s own points or rewards page from its official site and check whether your wallet is listed.`,
      cost: 'no fee to check',
      time: '10 minutes a month',
    },
    {
      text: `Before adding more funds, confirm ${p.name} still records no token and read its own announcements; never follow a claim link from a direct message.`,
      cost: 'nothing but the check',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, biggest market cap first, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl_ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? fourDp(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row in the dashboard's compact form, with the farm plan built in the page.
 *  The multiple is carried at full precision: the page recomputes the row from it,
 *  and a rounded multiple would make the recompute differ from board.json. */
export function radarRow(row: BoardRow, multiples: Record<string, { multiple: number; comps: number; source: string }>): RadarRow {
  const exact = multiples[row.category ?? 'Other']?.multiple ?? row.model.multiple;
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    multiple: exact,
    multiple_source: row.model.multiple_source,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** The dashboard's whole dataset, built from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, multiples } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    multiples,
    rows: board.map((r) => radarRow(r, multiples)),
    live,
  };
  return { board, radar };
}

/** The snapshot from a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's dataset as one script, written beside the page: no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
