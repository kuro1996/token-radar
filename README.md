# Token Radar

Pre-token protocols ranked by implied value — an entry for make.fun's
[token-radar-01](https://make.fun/bounty/token-radar-01) bounty ($1,325 in USDC).

## What it is

A program plus the dashboard it writes. `main.ts` reads the sealed DefiLlama
snapshot (`/input/snapshot.json`), scores every genuine pre-token protocol with
a comparable-multiple model, and writes a ranked board, a dashboard and a
dossier for the judge.

## The model (radar-2)

A pre-token protocol's token, if it launched at the multiple its live-token
peers trade at, would be worth its TVL times that multiple:

```
multiple   = median mcap/TVL of the live-token protocols in the same category
             (at least 3 of them; the whole market's median when a category
             has fewer), clamped to [0.02, 1.00]
implied    = round( tvl_usd x multiple
                    x (1 + clamp(change_7d, -50, 100) / 100 x 0.6)
                    x (0.6 + min(age_days, 1095) / 1095 x 0.4) )
```

The board covers all 40 watchlist protocols plus every genuine pre-token
protocol below the $50M floor. Wrapped, staked and bridged products never
take a rank: the board scores protocols still waiting on a launch of their
own. Each row carries a seven-step farm plan with costs and times, derived
from the protocol's category, chains, TVL and age.

"Records no token" means the protocol's DefiLlama record carries no token;
it is not proof the protocol has none. Implied value is this entry's own
claim, never a price and never a prediction that a token will be issued.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

Node 22 or later, standard library only, no network. The program runs twice
and writes the same bytes both times.

## Check it

```sh
node <kit>/cli/makefun.mjs check --kit <kit> --repo <this repository> --transcripts transcripts.tar.gz
```
