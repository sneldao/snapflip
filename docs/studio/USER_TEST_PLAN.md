# SnapFlip Studio — user test plan and clip plan

Goal: find out whether a first-time visitor understands the claim, finds the
lamp reveal without help, and wants to share the result. Run with five people
who have not seen the product before.

## Session script (about 10 minutes per person)

Setup: open the studio on a laptop, screen shared, phone for the mobile pass.
Do not explain the product before the task starts.

1. Hand over the URL and say: "Open this and tell me what you think is going
   on." Note the first sentence they say, verbatim.
2. Watch the listing and intro. Ask: "What is the seller claiming?" Note
   whether they say "mint" or describe the claim in their own words.
3. Ask them to check the item. Do not point at the lamp. Note how long before
   they first drag anything and what they try first.
4. When the damage is revealed, ask: "What just happened?" Note whether they
   connect the light to the condition.
5. When the buyer decides, ask: "Would the buyer buy this, and why?"
6. Ask them to change one thing and see the result. Note whether they use the
   prompt chips, the scenario buttons, or the keyboard.
7. Ask them to send the scene to someone. Note whether they find "Copy link".
8. Mobile pass: repeat steps 3–5 on a phone. Note any control they miss.

Record for each person:
- Time to first useful action (lamp drag)
- Whether they described the claim correctly
- Whether they found "Copy link" unprompted
- Any control they could not find, and where they looked
- The single thing they would change

Pass bar: at least four of five people reach the verdict without help, and
at least three can say what the buyer decided and why.

## 10-second clip plan

Shot list (one take, screen capture plus a physical cartridge shot if
available):

| Time | Shot | Purpose |
|------|------|---------|
| 0–2s | Listing says "Mint" | The claim |
| 2–4s | Lamp drags across the label, damage appears | The reveal |
| 4–6s | Evidence card pops in, camera kick | The proof |
| 6–8s | Buyer walks away, price line drops | The consequence |
| 8–10s | Caption: "Test the claim. Let a buyer decide." | The hook |

Rules:
- Use only the sample scene and label it simulated, as the product does.
- No fake metrics, testimonials, or live-money claims.
- Captions in the frame, not voiceover.

## Analytics

Events are sent to `POST /api/studio/event` and written to the Cloudflare
Workers Analytics Engine dataset `snapflip_studio` (binding `STUDIO_EVENTS`):
`reveal_damage`, `evidence_open`, `link_copied`, `chamber_reached`. Each event
is anonymous and carries only the event name and chapter. Unknown events are
rejected. The binding is optional, so events are dropped when it is absent.

The binding is intentionally left out of `wrangler.jsonc`: Analytics Engine is
not enabled on the deploy account, and binding it makes `wrangler deploy` fail
(code 10089). Events are dropped silently until the account enables Analytics
Engine (dashboard → Workers → Analytics Engine) and the binding is re-added —
the commented line in `wrangler.jsonc` shows how.
