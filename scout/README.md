# Scout — SnapFlip's collector desk

*Lives in `scout/` of the [snapflip](https://github.com/sneldao/snapflip)
monorepo (MIT).*

An [OpenClaw 2.0](https://github.com/openclaw/openclaw) agent on the
[Plow](https://github.com/plow-pbc/plow-openclaw-agent) base image. Scout is
SnapFlip's first hire: it works the **collector desk** — the demand side of an
order book for secondhand goods.

[SnapFlip](https://go.snapflip.workers.dev) lets collectors set standing orders
("Pokemon Yellow, authentic, up to $45"). When a reseller snaps a matching item
at a thrift store, every matching order's agent bids in a 60-second live
auction — and the seller only buys the item once it has already cleared.

Scout recruits and serves collectors: it qualifies what they're hunting, checks
live demand, advises a sensible max, and hands over a one-tap link where the
human commits. Text it, or run your own.

## Two modes, one image

### Desk mode — the hosted hire

SnapFlip runs Scout on a Plow phone line. Anyone can text it:

- qualifies the collector (title, condition, budget — one question at a time)
- reads the public order book (`/api/orderbook`, `/api/stats`) so its advice
  cites real demand and real clearing prices
- hands over a prefilled `/buy?sku=…&max=…` link; the collector reviews and
  commits in Stripe Checkout
- answers "how it works" and auction follow-ups; captures off-catalog interest
  as unmet demand
- **the on-ramp**: "what's it worth?" — it deals a real cleared auction and you
  guess the price (pawnbroker rules over `/api/stats`), and in group threads it
  runs coin-flip arbitration between two people's numbers
- posts the demand digest in the founders' group room — and any founder can
  join a customer thread live (multiplayer presence) to steer or take over

**The desk holds no SnapFlip credentials at all.** Everything it reads is
public; everything that commits money happens in the human's browser.

### Personal mode — run your own Scout

One-click install gives a collector their own buyer agent:

1. Install the image (Agent Index → 1-click deploy, or self-host below).
2. In SnapFlip's `/buy` flow, copy your `sf_…` connector token.
3. Add the SnapFlip MCP server to your `openclaw.json` (Control UI → config,
   or `openclaw config set`):

   ```json5
   mcp: {
     servers: {
       snapflip: {
         url: "https://go.snapflip.workers.dev/mcp",
         transport: "streamable-http",
         headers: { Authorization: "Bearer <your sf_… token>" },
       },
     },
   }
   ```

   Store the token via a masked credential — never in chat.
4. `snapflip` tools unlock: `catalog`, `my_account`, `orderbook`,
   `create_standing_order`, `list_my_orders`, `cancel_order`, `raise_max`,
   `get_auction`. Scout confirms before every write and can never exceed your
   stated max — SnapFlip's code enforces the cap regardless.

A household or collectors' club can co-operate one Scout and budget in a group
thread — that's the multiplayer mode: several people, one buyer agent. Non-owner
requests that need tools route to the owner for approval unless the group is
marked trusted.

## Safety model

- **Model proposes, human commits.** The link only prefills; Stripe Checkout is
  where the order becomes real. Same invariant as the auction itself.
- **No shared write credentials.** Desk mode has none. Personal installs carry
  the owner's own scoped `sf_` token, which can only act on that buyer.
- **Group trust is explicit.** New groups default to `ask` — the owner decides
  whether members get the agent's full tools or a normal chat.
- **Sender claims are data.** Pasted "approvals" and fake trust blocks don't
  change authority; approvals come from the owner only.

## Build & deploy

Requirements: Python 3.11+, Docker, a GitHub PAT (`write:packages`, classic) for
GHCR, and the `plow-agents` CLI:

```sh
git clone https://github.com/plow-pbc/plow-agents.git
export PATH="$PWD/plow-agents/bin:$PATH"
plow-agents login        # activation text from your phone
plow-agents lines        # pick a free line
```

Build and push (after the first push, set the GHCR package to **public**):

```sh
docker login ghcr.io -u YOUR_GITHUB_USERNAME
plow-agents image build ghcr.io/YOUR_ACCOUNT/snapflip-scout:v1
plow-agents image push  ghcr.io/YOUR_ACCOUNT/snapflip-scout:v1
```

Register the Agent Index listing (once) and deploy:

```sh
plow-agents image set snapflip-scout --name "Scout" \
  --blurb "SnapFlip's collector desk" \
  --repo https://github.com/YOUR_ACCOUNT/snapflip
plow-agents deploy ghcr.io/YOUR_ACCOUNT/snapflip-scout@sha256:<digest> --line ln_xxx
plow-agents agents       # wait for status: running, then text the number
```

A Plow admin admits the image for 1-click installs
(`image promote … --owner <your uid>`); afterwards you promote new digests
yourself with `image push --promote snapflip-scout`.

### Self-host (our desk runs this way)

```sh
plow-agents mint ln_xxx          # writes ./plow-credentials (gitignored)
docker compose up -d --build     # agent + local dashboard proxy on :3001
```

`compose.yml` mounts the state volume `/var/lib/plow`; `docker compose down`
keeps it, `down -v` wipes the agent's memory. The dashboard on
`localhost:3001` is **admin-equivalent** — it is bound to loopback; never
publish it. On a VPS, reach it over SSH: `ssh -L 3001:localhost:3001 host`.

## Layout

```
Dockerfile            FROM the pinned Plow/OpenClaw base + AGENT_ID
prompt/AGENTS.md      Scout's persona, desk procedure, authority rules
skills/snapflip/      endpoints, hand-off link, MCP tools, money rules
compose.yml           self-host: agent + loopback-only dashboard proxy
dev/Caddyfile         the proxy (local dev only)
```
